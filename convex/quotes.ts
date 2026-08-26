import { action, internalMutation, internalQuery, query } from './_generated/server'
import { internal } from './_generated/api'
import { ConvexError, v } from 'convex/values'
import { DEFAULT_PRICING, DEFAULT_TIMEZONE, OPERATING_BASE_ADDRESS } from './lib/defaultPricing'
import { localParts, localPickupToUtc } from './lib/time'
import { calculateRidePrice } from './lib/pricingCore.mjs'
import { mergePricingSnapshot } from './lib/pricingConfig.mjs'
import { bookingBlocksAvailability } from './lib/bookingState'

const internalApi: any = internal

const publicPlace = v.object({ placeId: v.string(), address: v.string() })
const publicError = (code: string, message: string): never => { throw new ConvexError({ code, message }) }
const sessionPattern = /^[a-zA-Z0-9_-]{20,100}$/
const supportedAirlines = new Set([
  'Alaska Airlines', 'Allegiant Air', 'American Airlines', 'Avelo Airlines', 'Breeze Airways',
  'Delta Air Lines', 'Frontier Airlines', 'Hawaiian Airlines', 'JetBlue Airways', 'Southwest Airlines',
  'Spirit Airlines', 'Sun Country Airlines', 'United Airlines', 'Alaska Seaplanes', 'Boutique Air',
  'Cape Air', 'Contour Airlines', 'Denver Air Connection', 'JSX', 'Kenmore Air', 'Mokulele Airlines',
  'Southern Airways Express', 'Tradewind Aviation', 'Other U.S. airline'
])

function requireSession(sessionId: string) {
  if (!sessionPattern.test(sessionId)) publicError('INVALID_SESSION', 'Please refresh the page and try again.')
}

function mapsToken(): string {
  const token = process.env.GEOAPIFY_API_KEY
  if (!token) publicError('MAPS_NOT_CONFIGURED', 'Online pricing is being configured. Please call 860-326-1089 for a quote.')
  return token!
}

function normalizedFeature(feature: any) {
  const p = feature.properties || feature || {}
  const coordinates = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : []
  return {
    placeId: p.place_id || feature.id,
    formattedAddress: p.formatted || [p.address_line1, p.address_line2].filter(Boolean).join(', '),
    latitude: Number(p.lat ?? coordinates[1]), longitude: Number(p.lon ?? coordinates[0]),
    city: p.city || p.town || p.village || p.county || '',
    state: p.state_code || p.state || '',
    postalCode: p.postcode || '', country: p.country_code || p.country || ''
  }
}

async function forwardGeocode(address: string, token: string) {
  const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete')
  url.searchParams.set('text', address)
  url.searchParams.set('format', 'json')
  url.searchParams.set('filter', 'countrycode:us')
  url.searchParams.set('bias', 'proximity:-73.7018,42.7301')
  url.searchParams.set('limit', '6')
  url.searchParams.set('lang', 'en')
  url.searchParams.set('apiKey', token)
  const response = await fetch(url)
  if (!response.ok) publicError('ADDRESS_PROVIDER_UNAVAILABLE', 'Address search is temporarily unavailable. Please try again.')
  const payload = await response.json()
  return (payload.results || []).map(normalizedFeature).filter((item: any) => item.placeId && item.formattedAddress && Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
}

async function reverseGeocode(latitude: number, longitude: number, token: string) {
  const url = new URL('https://api.geoapify.com/v1/geocode/reverse')
  url.searchParams.set('lat', String(latitude))
  url.searchParams.set('lon', String(longitude))
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '1')
  url.searchParams.set('lang', 'en')
  url.searchParams.set('apiKey', token)
  const response = await fetch(url)
  if (!response.ok) publicError('LOCATION_PROVIDER_UNAVAILABLE', 'We could not identify your current address. Please enter it manually.')
  const payload = await response.json()
  return (payload.results || []).map(normalizedFeature).find((item: any) => item.placeId && item.formattedAddress && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)) || null
}

async function resolveAddress(ctx: any, sessionId: string, place: { placeId: string, address: string }) {
  if (!place.placeId || place.address.trim().length < 5) publicError('INVALID_ADDRESS', 'Select a validated address from the suggestions.')
  const selected = await ctx.runQuery(internalApi.quotes.getAddressSelection, { sessionId, placeId: place.placeId, address: place.address.trim(), now: Date.now() })
  if (!selected) publicError('ADDRESS_CHANGED', 'That address could not be revalidated. Select it from the suggestions again.')
  return selected
}

async function routeLeg(origin: any, destination: any, token: string, config: any, scheduledPickupAt: number) {
  const url = new URL('https://api.geoapify.com/v1/routing')
  url.searchParams.set('waypoints', `${origin.latitude},${origin.longitude}|${destination.latitude},${destination.longitude}`)
  url.searchParams.set('mode', 'drive')
  url.searchParams.set('type', 'balanced')
  url.searchParams.set('format', 'json')
  url.searchParams.set('apiKey', token)
  const response = await fetch(url)
  if (!response.ok) publicError('ROUTE_PROVIDER_UNAVAILABLE', 'We could not calculate that route right now. Please try again.')
  const payload = await response.json()
  const route = payload.results?.[0]
  if (!route) publicError('ROUTE_NOT_FOUND', 'No drivable route was found between those addresses.')
  const local = localParts(scheduledPickupAt)
  const rush = (config.rushHourRules || []).some((rule: any) => rule.activeDays.includes(local.weekday) && local.time >= rule.startTime && local.time < rule.endTime)
  const trafficBps = rush ? Number(config.trafficFallbackBps || 10000) : 10000
  return {
    origin: { placeId: origin.placeId, address: origin.formattedAddress },
    destination: { placeId: destination.placeId, address: destination.formattedAddress },
    distanceMeters: Math.round(route.distance), normalDurationSeconds: Math.round(route.time),
    trafficDurationSeconds: Math.round(route.time * trafficBps / 10000),
    tollEstimateCents: 0, tollsAvailable: false,
    provider: 'geoapify', providerRouteId: null, routeTimestamp: Date.now()
  }
}

function aggregateRoute(legs: any[]) {
  const positioning = legs[0], returning = legs[legs.length - 1], passenger = legs.slice(1, -1)
  const sum = (rows: any[], key: string) => rows.reduce((total, row) => total + Number(row[key] || 0), 0)
  return {
    legs,
    positioningDistanceMeters: positioning.distanceMeters,
    positioningNormalDurationSeconds: positioning.normalDurationSeconds,
    positioningTrafficDurationSeconds: positioning.trafficDurationSeconds,
    passengerDistanceMeters: sum(passenger, 'distanceMeters'),
    passengerNormalDurationSeconds: sum(passenger, 'normalDurationSeconds'),
    passengerTrafficDurationSeconds: sum(passenger, 'trafficDurationSeconds'),
    returnDistanceMeters: returning.distanceMeters,
    returnNormalDurationSeconds: returning.normalDurationSeconds,
    returnTrafficDurationSeconds: returning.trafficDurationSeconds,
    tollEstimateCents: sum(legs, 'tollEstimateCents'), tollsAvailable: legs.every(row => row.tollsAvailable)
  }
}

function routeDurationMs(route: any, waitMinutes = 0, stopCount = 0, stopAllowance = 0) {
  return (route.positioningTrafficDurationSeconds + route.passengerTrafficDurationSeconds + route.returnTrafficDurationSeconds) * 1000 + (waitMinutes + stopCount * stopAllowance) * 60000
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export const searchAddresses = action({
  args: { sessionId: v.string(), query: v.string() },
  handler: async (ctx, { sessionId, query: text }) => {
    requireSession(sessionId)
    await ctx.runMutation(internalApi.quotes.consumeRateLimit, { key: `address:${sessionId}`, limit: 120, windowMs: 60000 })
    if (!text.trim()) return []
    const results = await forwardGeocode(text.trim(), mapsToken())
    await ctx.runMutation(internalApi.quotes.cacheAddressSelections, { sessionId, results })
    return results.map(({ latitude, longitude, ...safe }: any) => safe)
  }
})

export const locateAddress = action({
  args: { sessionId: v.string(), latitude: v.number(), longitude: v.number() },
  handler: async (ctx, args) => {
    requireSession(args.sessionId)
    await ctx.runMutation(internalApi.quotes.consumeRateLimit, { key: `location:${args.sessionId}`, limit: 12, windowMs: 60000 })
    if (!Number.isFinite(args.latitude) || !Number.isFinite(args.longitude) || Math.abs(args.latitude) > 90 || Math.abs(args.longitude) > 180) {
      publicError('INVALID_LOCATION', 'Your device returned an invalid location. Please enter the pickup address manually.')
    }
    const result = await reverseGeocode(args.latitude, args.longitude, mapsToken())
    if (!result) publicError('LOCATION_NOT_FOUND', 'We could not identify your current address. Please enter it manually.')
    await ctx.runMutation(internalApi.quotes.cacheAddressSelections, { sessionId: args.sessionId, results: [result] })
    return { placeId: result.placeId, address: result.formattedAddress }
  }
})

export const cacheAddressSelections = internalMutation({
  args: { sessionId: v.string(), results: v.array(v.any()) },
  handler: async (ctx, { sessionId, results }) => {
    const createdAt = Date.now(), expiresAt = createdAt + 2 * 60 * 60 * 1000
    for (const result of results) {
      const record = {
        sessionId, placeId: result.placeId, formattedAddress: result.formattedAddress,
        latitude: result.latitude, longitude: result.longitude, city: result.city || '', state: result.state || '',
        postalCode: result.postalCode || '', country: result.country || '', expiresAt, createdAt
      }
      const existing = await ctx.db.query('addressSelections').withIndex('by_session_place', q => q.eq('sessionId', sessionId).eq('placeId', result.placeId)).first()
      if (existing) await ctx.db.patch(existing._id, record)
      else await ctx.db.insert('addressSelections', record)
    }
  }
})

export const getAddressSelection = internalQuery({
  args: { sessionId: v.string(), placeId: v.string(), address: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const selected = await ctx.db.query('addressSelections').withIndex('by_session_place', q => q.eq('sessionId', args.sessionId).eq('placeId', args.placeId)).first()
    if (!selected || selected.expiresAt <= args.now || selected.formattedAddress !== args.address) return null
    return {
      placeId: selected.placeId, formattedAddress: selected.formattedAddress,
      latitude: selected.latitude, longitude: selected.longitude, city: selected.city, state: selected.state,
      postalCode: selected.postalCode, country: selected.country
    }
  }
})

export const consumeRateLimit = internalMutation({
  args: { key: v.string(), limit: v.number(), windowMs: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now()
    const row = await ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', args.key)).unique()
    if (!row || now - row.windowStartedAt >= args.windowMs) {
      if (row) await ctx.db.patch(row._id, { windowStartedAt: now, count: 1 })
      else await ctx.db.insert('rateLimits', { key: args.key, windowStartedAt: now, count: 1 })
      return
    }
    if (row.count >= args.limit) publicError('RATE_LIMITED', 'Too many requests. Wait a moment and try again.')
    await ctx.db.patch(row._id, { count: row.count + 1 })
  }
})

export const getFoundation = internalQuery({
  args: {},
  handler: async (ctx) => {
    const configs = await ctx.db.query('pricingConfigs').withIndex('by_active', q => q.eq('active', true)).collect()
    const config = configs.sort((a, b) => b.version - a.version)[0] || null
    const vehicles = await ctx.db.query('vehicles').withIndex('by_active', q => q.eq('active', true)).collect()
    const bases = await ctx.db.query('operatingBases').withIndex('by_active', q => q.eq('active', true)).collect()
    const holidays = await ctx.db.query('holidayRules').withIndex('by_active', q => q.eq('active', true)).collect()
    const events = await ctx.db.query('specialEventRules').withIndex('by_active', q => q.eq('active', true)).collect()
    return {
      config: config ? { ...config, snapshot: mergePricingSnapshot(DEFAULT_PRICING, config.snapshot) } : null,
      vehicle: vehicles[0] || null, base: bases[0] || null, holidays, events
    }
  }
})

export const ensureFoundation = internalMutation({
  args: { base: v.any() },
  handler: async (ctx, { base }) => {
    const now = Date.now()
    const config = await ctx.db.query('pricingConfigs').withIndex('by_active', q => q.eq('active', true)).first()
    if (!config) await ctx.db.insert('pricingConfigs', { version: 1, effectiveAt: now, createdBy: 'system-bootstrap', createdAt: now, snapshot: DEFAULT_PRICING, active: true })
    const vehicle = await ctx.db.query('vehicles').withIndex('by_active', q => q.eq('active', true)).first()
    if (!vehicle) await ctx.db.insert('vehicles', { name: '2017 Ford Expedition Limited', make: 'Ford', model: 'Expedition Limited', year: 2017, active: true, createdAt: now, updatedAt: now })
    const existingBase = await ctx.db.query('operatingBases').withIndex('by_active', q => q.eq('active', true)).first()
    if (!existingBase) await ctx.db.insert('operatingBases', {
      name: 'Watervliet operating base', address: OPERATING_BASE_ADDRESS, formattedAddress: base.formattedAddress,
      placeId: base.placeId, latitude: base.latitude, longitude: base.longitude,
      timezone: DEFAULT_TIMEZONE, active: true, createdAt: now, updatedAt: now
    })
  }
})

async function foundation(ctx: any, token: string) {
  let state: any = await ctx.runQuery(internalApi.quotes.getFoundation, {})
  if (!state.config || !state.vehicle || !state.base) {
    const [base] = await forwardGeocode(OPERATING_BASE_ADDRESS, token)
    if (!base) publicError('BASE_ADDRESS_ERROR', 'The operating base could not be resolved. Please contact support.')
    await ctx.runMutation(internalApi.quotes.ensureFoundation, { base })
    state = await ctx.runQuery(internalApi.quotes.getFoundation, {})
  }
  return state
}

export const checkAvailability = internalQuery({
  args: { vehicleId: v.id('vehicles'), scheduledAt: v.number(), expectedEndAt: v.number(), config: v.any() },
  handler: async (ctx, args) => {
    const now = Date.now()
    const bookings = (await ctx.db.query('bookings').collect()).filter(row => bookingBlocksAvailability(row, now))
    const blocks = (await ctx.db.query('blackoutPeriods').withIndex('by_active', q => q.eq('active', true)).collect()).filter(row => !row.vehicleId || row.vehicleId === args.vehicleId)
    const occupied = [
      ...bookings.map(row => ({ startAt: localPickupToUtc(row.serviceDate, row.startTime), endAt: localPickupToUtc(row.serviceDate, row.endTime), type: 'booking' })),
      ...blocks.map(row => ({ startAt: row.startAt, endAt: row.endAt, type: 'block' }))
    ].sort((a, b) => a.startAt - b.startAt)
    const conflict = occupied.find(row => args.scheduledAt < row.endAt && args.expectedEndAt > row.startAt)
    if (conflict) return { status: 'unavailable', reason: 'schedule_conflict', conflictType: conflict.type }
    const gaps = occupied.flatMap(row => [Math.abs(args.scheduledAt - row.endAt), Math.abs(row.startAt - args.expectedEndAt)]).filter(value => value >= 0)
    const closestGapMinutes = gaps.length ? Math.min(...gaps) / 60000 : Number.POSITIVE_INFINITY
    const status = closestGapMinutes < args.config.confirmationRequiredThresholdMinutes ? 'confirmation_required'
      : closestGapMinutes < args.config.limitedAvailabilityThresholdMinutes ? 'limited_availability' : 'available'
    const pickupLocal = localParts(args.scheduledAt)
    const sameDay = bookings.filter(row => row.serviceDate === pickupLocal.date).length
    const nearby = bookings.filter(row => Math.abs(localPickupToUtc(row.serviceDate, row.startTime) - args.scheduledAt) <= 3 * 3600000).length
    return { status, closestGapMinutes: Number.isFinite(closestGapMinutes) ? Math.round(closestGapMinutes) : null, sameDayBookings: sameDay, nearbyBookings: nearby }
  }
})

function demandSnapshot(availability: any, config: any) {
  const rule = config.demandRules || {}
  const applies = Boolean(rule.active && (availability.nearbyBookings >= rule.nearbyBookingThreshold || availability.sameDayBookings >= rule.dailyBookingThreshold))
  return { applies, nearbyBookings: availability.nearbyBookings || 0, sameDayBookings: availability.sameDayBookings || 0, flatCents: rule.flatCents || 0, percentageBps: rule.percentageBps || 0, maximumAdjustmentCents: rule.maximumAdjustmentCents || 0 }
}

function applicableRule(rows: any[], scheduledAt: number) {
  return rows.filter(row => row.startAt <= scheduledAt && row.endAt > scheduledAt).sort((a, b) => b.percentageBps - a.percentageBps || b.flatCents - a.flatCents)[0] || null
}

export const saveEstimate = internalMutation({
  args: { record: v.any() },
  handler: async (ctx, { record }) => ctx.db.insert('rideEstimates', record)
})

export const saveQuote = internalMutation({
  args: { record: v.any(), estimateId: v.optional(v.id('rideEstimates')) },
  handler: async (ctx, { record, estimateId }) => {
    const id = await ctx.db.insert('rideQuotes', record)
    if (estimateId) await ctx.db.patch(estimateId, { status: 'converted' })
    return id
  }
})

export const generateHomepageQuote = action({
  args: { sessionId: v.string(), pickup: publicPlace, dropoff: publicPlace, pickupDate: v.string(), dropoffDate: v.optional(v.string()), pickupTime: v.string() },
  handler: async (ctx, args) => {
    requireSession(args.sessionId)
    await ctx.runMutation(internalApi.quotes.consumeRateLimit, { key: `quote:${args.sessionId}`, limit: 12, windowMs: 60000 })
    const dropoffDate = args.dropoffDate
    if (dropoffDate && dropoffDate < args.pickupDate) publicError('INVALID_DATE_RANGE', 'Drop-off date cannot be before the pickup date.')
    const token = mapsToken(), now = Date.now(), scheduledPickupAt = localPickupToUtc(args.pickupDate, args.pickupTime)
    if (scheduledPickupAt <= now) publicError('PAST_PICKUP', 'Choose a pickup time in the future.')
    const state = await foundation(ctx, token), config = state.config.snapshot
    const [pickup, dropoff] = await Promise.all([resolveAddress(ctx, args.sessionId, args.pickup), resolveAddress(ctx, args.sessionId, args.dropoff)])
    const base = { ...state.base, placeId: state.base.placeId }
    const legs = await Promise.all([routeLeg(base, pickup, token, config, scheduledPickupAt), routeLeg(pickup, dropoff, token, config, scheduledPickupAt), routeLeg(dropoff, base, token, config, scheduledPickupAt)])
    const route = aggregateRoute(legs)
    const occupiedMs = routeDurationMs(route, 0, 0, config.stopDurationAllowanceMinutes) + (config.cleaningBufferMinutes + config.preparationBufferMinutes + config.driverBreakBufferMinutes) * 60000
    const availability = await ctx.runQuery(internalApi.quotes.checkAvailability, { vehicleId: state.vehicle._id, scheduledAt: scheduledPickupAt, expectedEndAt: scheduledPickupAt + occupiedMs, config })
    const demand = demandSnapshot(availability, config), local = localParts(scheduledPickupAt)
    const automaticPromotion = await ctx.runQuery(internalApi.promotions.activeAutomatic, { now, serviceType: 'one_way' })
    const totalRouteMiles = (route.positioningDistanceMeters + route.passengerDistanceMeters + route.returnDistanceMeters) / 1609.344
    const pickupState = String(pickup.state || '').replace('US-', '')
    const dropoffState = String(dropoff.state || '').replace('US-', '')
    const outsideArea = totalRouteMiles > config.maximumTotalRouteMiles || route.positioningDistanceMeters / 1609.344 > config.maximumPickupDistanceMiles || (pickupState && !config.allowedStates.includes(pickupState)) || (dropoffState && !config.allowedStates.includes(dropoffState))
    const pricing = calculateRidePrice({ route, pickupTime: args.pickupTime, pickupWeekday: local.weekday, scheduledPickupAt, now, requestedWaitMinutes: 0, additionalStopCount: 0, availability, demand, promotions: automaticPromotion ? [automaticPromotion] : [], holidayRule: applicableRule(state.holidays, scheduledPickupAt), specialEventRule: applicableRule(state.events, scheduledPickupAt), manualReview: outsideArea }, config)
    const status = availability.status === 'unavailable' ? 'unavailable' : pricing.manualReview ? 'confirmation_required' : 'quoted'
    const createdAt = Date.now(), expiresAt = createdAt + config.homepageQuoteExpirationMinutes * 60000
    const record = {
      sessionId: args.sessionId, pickupPlaceId: pickup.placeId, pickupAddress: pickup.formattedAddress, pickupCoordinates: { latitude: pickup.latitude, longitude: pickup.longitude },
      dropoffPlaceId: dropoff.placeId, dropoffAddress: dropoff.formattedAddress, dropoffCoordinates: { latitude: dropoff.latitude, longitude: dropoff.longitude },
      pickupDate: args.pickupDate, ...(dropoffDate ? { dropoffDate } : {}), pickupTime: args.pickupTime, scheduledPickupAt, timezone: DEFAULT_TIMEZONE,
      operatingBaseId: state.base._id, vehicleId: state.vehicle._id, routeSnapshot: route,
      trafficSnapshot: { method: 'provider-duration-with-configured-time-window-fallback', normalSeconds: route.passengerNormalDurationSeconds, adjustedSeconds: route.passengerTrafficDurationSeconds },
      availabilitySnapshot: availability, demandSnapshot: demand,
      pricingBreakdown: { customer: pricing.customerBreakdown, internal: pricing.internalBreakdown },
      estimatedPriceCents: pricing.finalPriceCents, pricingConfigVersion: state.config.version, status, createdAt, expiresAt
    }
    const estimateId = await ctx.runMutation(internalApi.quotes.saveEstimate, { record })
    return { estimateId, status, expiresAt, estimatedPriceCents: pricing.finalPriceCents, pickupAddress: pickup.formattedAddress, dropoffAddress: dropoff.formattedAddress, pickupDate: args.pickupDate, ...(dropoffDate ? { dropoffDate } : {}), pickupTime: args.pickupTime, passengerMiles: pricing.passengerMiles, passengerMinutes: pricing.passengerMinutes, promotion: pricing.appliedPromotion ? { id: pricing.appliedPromotion.promotionId, kind: pricing.appliedPromotion.kind, name: pricing.appliedPromotion.name, percentageBps: pricing.appliedPromotion.percentageBps, discountCents: pricing.discountCents } : null, customerBreakdown: pricing.customerBreakdown.filter((line: any) => !['Total', 'Route and travel', 'Vehicle positioning and travel'].includes(line.label)) }
  }
})

export const getHomepageEstimate = query({
  args: { estimateId: v.id('rideEstimates'), sessionId: v.string() },
  handler: async (ctx, args) => {
    requireSession(args.sessionId)
    const estimate = await ctx.db.get(args.estimateId)
    if (!estimate || estimate.sessionId !== args.sessionId) return null
    if (estimate.expiresAt <= Date.now()) return { expired: true }
    return {
      estimateId: estimate._id, pickup: { placeId: estimate.pickupPlaceId, address: estimate.pickupAddress }, dropoff: { placeId: estimate.dropoffPlaceId, address: estimate.dropoffAddress },
      pickupDate: estimate.pickupDate, ...(estimate.dropoffDate ? { dropoffDate: estimate.dropoffDate } : {}), pickupTime: estimate.pickupTime
    }
  }
})

export const generateBookingQuote = action({
  args: {
    sessionId: v.string(), estimateId: v.optional(v.id('rideEstimates')),
    pickup: publicPlace, dropoff: publicPlace, pickupDate: v.string(), pickupTime: v.string(),
    tripType: v.string(), passengerCount: v.number(), luggageCount: v.number(), stops: v.array(publicPlace),
    requestedWaitMinutes: v.number(), roundTripDetails: v.optional(v.any()), airportOptions: v.optional(v.any()),
    hourlyDetails: v.optional(v.any()), eventOptions: v.optional(v.any()), promotionCode: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    requireSession(args.sessionId)
    await ctx.runMutation(internalApi.quotes.consumeRateLimit, { key: `bookingquote:${args.sessionId}`, limit: 20, windowMs: 60000 })
    if (args.passengerCount < 1 || args.passengerCount > 7 || args.luggageCount < 0 || args.luggageCount > 12 || args.stops.length > 6) publicError('INVALID_BOOKING_OPTIONS', 'Review the passenger, luggage, and stop details.')
    let airportOptions: { enabled: true, direction: string, airline: string, flightNumber: string } | undefined
    if (args.airportOptions?.enabled) {
      const direction = String(args.airportOptions.direction || '')
      const airline = String(args.airportOptions.airline || '').trim()
      const flightNumber = String(args.airportOptions.flightNumber || '').trim().toUpperCase()
      if (!['pickup', 'dropoff'].includes(direction) || !supportedAirlines.has(airline) || !/^[A-Z0-9 -]{2,20}$/.test(flightNumber)) {
        publicError('INVALID_AIRPORT_DETAILS', 'Choose the airline and enter a valid flight number.')
      }
      airportOptions = { enabled: true, direction, airline, flightNumber }
    }
    const token = mapsToken(), now = Date.now(), scheduledPickupAt = localPickupToUtc(args.pickupDate, args.pickupTime)
    if (scheduledPickupAt <= now) publicError('PAST_PICKUP', 'Choose a pickup time in the future.')
    const state = await foundation(ctx, token), config = state.config.snapshot
    const resolved = await Promise.all([resolveAddress(ctx, args.sessionId, args.pickup), ...args.stops.map(stop => resolveAddress(ctx, args.sessionId, stop)), resolveAddress(ctx, args.sessionId, args.dropoff)])
    let passengerPoints = resolved
    let roundTripReturnAt: number | null = null
    if (args.tripType === 'round_trip' && args.roundTripDetails?.pickup?.placeId && args.roundTripDetails?.dropoff?.placeId) {
      const returnAt = localPickupToUtc(args.roundTripDetails.date, args.roundTripDetails.time)
      if (returnAt <= scheduledPickupAt) publicError('INVALID_RETURN_TIME', 'The return pickup must be after the outbound pickup.')
      roundTripReturnAt = returnAt
      const [returnPickup, returnDropoff] = await Promise.all([resolveAddress(ctx, args.sessionId, args.roundTripDetails.pickup), resolveAddress(ctx, args.sessionId, args.roundTripDetails.dropoff)])
      passengerPoints = [...resolved, returnPickup, returnDropoff]
    }
    const base = { ...state.base, placeId: state.base.placeId }
    const allPoints = [base, ...passengerPoints, base]
    const legs = await Promise.all(allPoints.slice(0, -1).map((point, index) => routeLeg(point, allPoints[index + 1], token, config, scheduledPickupAt)))
    const route = aggregateRoute(legs)
    const occupiedMs = routeDurationMs(route, args.requestedWaitMinutes, args.stops.length, config.stopDurationAllowanceMinutes) + (config.cleaningBufferMinutes + config.preparationBufferMinutes + config.driverBreakBufferMinutes) * 60000
    const postReturnMs = roundTripReturnAt ? (legs.slice(-2).reduce((total, leg) => total + leg.trafficDurationSeconds, 0) * 1000) + (config.cleaningBufferMinutes + config.preparationBufferMinutes + config.driverBreakBufferMinutes) * 60000 : 0
    const expectedEndAt = Math.max(scheduledPickupAt + occupiedMs, roundTripReturnAt ? roundTripReturnAt + postReturnMs : 0)
    const availability = await ctx.runQuery(internalApi.quotes.checkAvailability, { vehicleId: state.vehicle._id, scheduledAt: scheduledPickupAt, expectedEndAt, config })
    const demand = demandSnapshot(availability, config), local = localParts(scheduledPickupAt)
    const promotions: any[] = []
    const automaticPromotion = await ctx.runQuery(internalApi.promotions.activeAutomatic, { now, serviceType: args.tripType })
    if (automaticPromotion) promotions.push(automaticPromotion)
    if (args.promotionCode?.trim()) promotions.push(await ctx.runQuery(internalApi.quotes.validatePromotion, { code: args.promotionCode.trim().toUpperCase(), serviceType: args.tripType, now }))
    const roundTripDiscountBps = Math.max(0, Number(config.roundTripDiscountPercentageBps || 0))
    const roundTripPromotion = args.tripType === 'round_trip' && config.roundTripDiscountEnabled && roundTripDiscountBps
      ? { kind: 'automatic', name: 'Round-trip savings', discountLabel: `Round-trip savings (${roundTripDiscountBps / 100}% off)`, flatDiscountCents: 0, percentageBps: roundTripDiscountBps, maximumDiscountCents: 0, minimumBookingCents: 0, allowBelowMinimum: true }
      : null
    const totalRouteMiles = (route.positioningDistanceMeters + route.passengerDistanceMeters + route.returnDistanceMeters) / 1609.344
    const pickupState = String(resolved[0].state || '').replace('US-', ''), dropoffState = String(resolved[resolved.length - 1].state || '').replace('US-', '')
    const pricingInput = { route, pickupTime: args.pickupTime, pickupWeekday: local.weekday, scheduledPickupAt, now, requestedWaitMinutes: args.requestedWaitMinutes, additionalStopCount: args.stops.length, availability, demand, airportOptions, hourlyDetails: args.hourlyDetails, eventOptions: args.eventOptions, promotions, roundTripPromotion, holidayRule: applicableRule(state.holidays, scheduledPickupAt), specialEventRule: applicableRule(state.events, scheduledPickupAt), manualReview: totalRouteMiles > config.maximumTotalRouteMiles || args.stops.length > 4 || (pickupState && !config.allowedStates.includes(pickupState)) || (dropoffState && !config.allowedStates.includes(dropoffState)) }
    const pricing = calculateRidePrice(pricingInput, config)
    const status = availability.status === 'unavailable' ? 'rejected' : pricing.manualReview ? 'manual_review_required' : 'instant_quote'
    const createdAt = Date.now(), expiresAt = createdAt + config.bookingQuoteExpirationMinutes * 60000
    const requestInputs = { ...args, airportOptions, pickup: { placeId: resolved[0].placeId, address: resolved[0].formattedAddress }, dropoff: { placeId: resolved[resolved.length - 1].placeId, address: resolved[resolved.length - 1].formattedAddress } }
    const integrity = { customerSessionId: args.sessionId, requestInputs, route, pricingVersion: state.config.version, finalPriceCents: pricing.finalPriceCents, expiresAt }
    const quoteHash = await sha256(integrity)
    const record = {
      customerSessionId: args.sessionId, estimateId: args.estimateId, scheduledPickupAt, expectedEndAt, tripType: args.tripType,
      passengerCount: args.passengerCount, luggageCount: args.luggageCount, requestInputs, routeSnapshot: route,
      availabilitySnapshot: availability, demandSnapshot: demand, pricingBreakdown: { customer: pricing.customerBreakdown, internal: pricing.internalBreakdown },
      subtotalCents: pricing.subtotalCents, discountCents: pricing.discountCents, taxCents: pricing.taxCents, gratuityCents: pricing.gratuityCents,
      tollEstimateCents: pricing.tollEstimateCents, finalPriceCents: pricing.finalPriceCents, pricingConfigVersion: state.config.version,
      pricingSnapshot: config, quoteHash, status, createdAt, expiresAt,
      promotionId: pricing.appliedPromotion?.promotionId,
      promotionSnapshot: pricing.appliedPromotion ? { kind: pricing.appliedPromotion.kind, name: pricing.appliedPromotion.name, code: pricing.appliedPromotion.code, percentageBps: pricing.appliedPromotion.percentageBps, discountCents: pricing.discountCents } : undefined
    }
    const quoteId = await ctx.runMutation(internalApi.quotes.saveQuote, { record, estimateId: args.estimateId })
    return { quoteId, status, expiresAt, finalPriceCents: pricing.finalPriceCents, discountCents: pricing.discountCents, passengerMiles: pricing.passengerMiles, passengerMinutes: pricing.passengerMinutes, customerBreakdown: pricing.customerBreakdown, availability: availability.status, promotion: pricing.appliedPromotion ? { ...(pricing.appliedPromotion.promotionId ? { id: pricing.appliedPromotion.promotionId } : {}), kind: pricing.appliedPromotion.kind, name: pricing.appliedPromotion.name, code: pricing.appliedPromotion.kind === 'code' ? pricing.appliedPromotion.code : undefined, percentageBps: pricing.appliedPromotion.percentageBps, discountCents: pricing.discountCents } : null }
  }
})

export const validatePromotion = internalQuery({
  args: { code: v.string(), serviceType: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const promotion = await ctx.db.query('promotions').withIndex('by_code', q => q.eq('code', args.code)).unique()
    if (!promotion) publicError('INVALID_PROMOTION', 'That promotion code is not valid for this trip.')
    const validPromotion = promotion!
    if (!validPromotion.active || validPromotion.kind === 'automatic' || validPromotion.startAt > args.now || validPromotion.endAt <= args.now || validPromotion.uses >= validPromotion.usageLimit || (validPromotion.serviceTypes.length && !validPromotion.serviceTypes.includes(args.serviceType))) publicError('INVALID_PROMOTION', 'That promotion code is not valid for this trip.')
    return { promotionId: validPromotion._id, kind: 'code', name: validPromotion.name || 'Repeat customer discount', code: validPromotion.code, discountLabel: validPromotion.name || 'Repeat customer discount', flatDiscountCents: validPromotion.flatDiscountCents, percentageBps: validPromotion.percentageBps, maximumDiscountCents: validPromotion.maximumDiscountCents, minimumBookingCents: validPromotion.minimumBookingCents, allowBelowMinimum: validPromotion.allowBelowMinimum, startAt: validPromotion.startAt, endAt: validPromotion.endAt }
  }
})
