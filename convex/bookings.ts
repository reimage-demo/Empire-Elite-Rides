import { mutation, query } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { requireActiveSession } from './lib/sessionToken'
import { bookingBlocksAvailability } from './lib/bookingState'
import { localPickupToUtc } from './lib/time'
import { capacityIssue, MAX_DAILY_RESERVATIONS } from './lib/capacityCore.mjs'
import { FLEET, fleetVehicle, publicVehicle, requireFleetVehicle } from './lib/fleet'

const status = v.union(v.literal('payment_pending'), v.literal('requested'), v.literal('manual_review'), v.literal('confirmed'), v.literal('completed'), v.literal('cancelled'), v.literal('refunded'))

function timeValue(date: string, time: string) {
  return Date.parse(`${date}T${time}:00.000Z`)
}

function bookingError(code: string, message: string): never {
  throw new ConvexError({ code, message })
}

function newYorkNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).reduce<Record<string, string>>((result, part) => {
    result[part.type] = part.value
    return result
  }, {})
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

function minutesFromTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function timeFromMinutes(total: number) {
  const safe = Math.max(0, Math.min(total, 24 * 60))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

async function requireAdmin(ctx: any, token: string) {
  return await requireActiveSession(ctx, token)
}

async function insertBooking(ctx: any, args: any, source: 'website' | 'admin') {
  const startAt = timeValue(args.serviceDate, args.startTime)
  const endAt = timeValue(args.serviceDate, args.endTime)
  const nowInNewYork = newYorkNow()
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) bookingError('INVALID_TIME_RANGE', 'End time must be later than start time.')
  if (args.fullName.trim().length < 2 || (args.email && !args.email.includes('@')) || args.phone.trim().length < 7) bookingError('INVALID_CONTACT_DETAILS', 'Please provide valid contact details.')
  if (args.contactMethod === 'email' && !args.email) bookingError('INVALID_CONTACT_DETAILS', 'An email address is required when email is the preferred contact method.')
  if (!args.eventType.trim()) bookingError('INVALID_OCCASION', 'Please choose an occasion.')
  if (!/^\d{2}:(00|15|30|45)$/.test(args.startTime) || !/^\d{2}:(00|15|30|45)$/.test(args.endTime)) bookingError('INVALID_TIME_INTERVAL', 'Please choose times in 15-minute intervals.')
  if (args.phone.replace(/\D/g, '').length !== 10) bookingError('INVALID_PHONE', 'Please provide a complete 10-digit phone number.')
  if (args.serviceDate < nowInNewYork.date) bookingError('PAST_DATE', 'Please choose a future date.')
  if (args.serviceDate === nowInNewYork.date && nowInNewYork.hour >= 12) bookingError('SAME_DAY_CUTOFF', 'Same-day reservations must be requested before 12:00 PM Eastern Time.')
  if (source === 'admin' && (!Number.isInteger(args.paymentAmountCents) || args.paymentAmountCents < 50 || args.paymentAmountCents > 10_000_000)) {
    bookingError('INVALID_PAYMENT_AMOUNT', 'Enter a payment amount between $0.50 and $100,000.00.')
  }

  const vehicle = await requireFleetVehicle(ctx, args.vehicleKey || FLEET[0].key)
  if (!vehicle) bookingError('VEHICLE_UNAVAILABLE', 'Choose an available vehicle.')
  const activeForDate = (await ctx.db.query('bookings').withIndex('by_date', (q: any) => q.eq('serviceDate', args.serviceDate)).collect()).filter((row: any) => bookingBlocksAvailability(row) && (!row.vehicleId || row.vehicleId === vehicle._id))
  const scheduledPickupAt = localPickupToUtc(args.serviceDate, args.startTime)
  const capacityReason = capacityIssue(activeForDate.map((row: any) => localPickupToUtc(row.serviceDate, row.startTime)), scheduledPickupAt)
  if (capacityReason === 'day_full') bookingError('DAY_FULL', 'Daily capacity has been reached for this date. Choose another date.')
  if (capacityReason === 'pickup_spacing') bookingError('TIME_UNAVAILABLE', 'Pickup times must be at least two hours apart. Choose another time.')
  const startMinutes = minutesFromTime(args.startTime), endMinutes = minutesFromTime(args.endTime)
  const conflict = activeForDate.some((row: any) => startMinutes < minutesFromTime(row.endTime) && endMinutes > minutesFromTime(row.startTime))
  if (conflict) bookingError('TIME_UNAVAILABLE', 'That time overlaps an existing reservation. Choose another time.')

  const now = Date.now()
  const confirmationCode = `EER-${now.toString(36).slice(-6).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`
  const normalizedEmail = args.email?.trim().toLowerCase() || undefined
  const { vehicleKey: _vehicleKey, ...bookingArgs } = args
  const id = await ctx.db.insert('bookings', {
    ...bookingArgs,
    vehicleId: vehicle._id,
    vehicleSnapshot: publicVehicle(vehicle),
    email: normalizedEmail,
    fullName: args.fullName.trim(),
    phone: args.phone.trim(),
    pickupAddress: args.pickupAddress.trim(),
    destination: args.destination.trim(),
    notes: args.notes.trim(),
    confirmationCode,
    startAt,
    endAt,
    source,
    status: source === 'admin' ? 'confirmed' : 'requested',
    paymentStatus: source === 'admin' ? 'checkout_pending' : 'not_required',
    paymentAmountCents: source === 'admin' ? args.paymentAmountCents : undefined,
    paymentCurrency: source === 'admin' ? 'usd' : undefined,
    paymentExpiresAt: source === 'admin' ? now + (24 * 60 - 5) * 60 * 1000 : undefined,
    createdAt: now,
    updatedAt: now
  })
  await ctx.scheduler.runAfter(0, internal.notifications.sendBooking, {
    bookingId: String(id),
    confirmationCode,
    source,
    fullName: args.fullName.trim(),
    phone: args.phone.trim(),
    email: normalizedEmail,
    contactMethod: args.contactMethod,
    eventType: args.eventType,
    tripType: args.tripType,
    serviceDate: args.serviceDate,
    startTime: args.startTime,
    endTime: args.endTime,
    pickupAddress: args.pickupAddress.trim(),
    destination: args.destination.trim(),
    notes: args.notes.trim() || undefined,
    vehicleName: vehicle.name
  })
  return { id, confirmationCode }
}

export const create = mutation({
  args: {
    fullName: v.string(), email: v.string(), phone: v.string(),
    contactMethod: v.union(v.literal('text'), v.literal('call'), v.literal('email')),
    eventCategory: v.optional(v.string()),
    eventType: v.string(),
    tripType: v.union(v.literal('pickup'), v.literal('dropoff'), v.literal('both')),
    serviceDate: v.string(), startTime: v.string(), endTime: v.string(),
    pickupAddress: v.string(), destination: v.string(), notes: v.string(), vehicleKey: v.optional(v.string())
  },
  handler: async (ctx, args) => insertBooking(ctx, args, 'website')
})

export const createAdmin = mutation({
  args: {
    sessionToken: v.string(),
    fullName: v.string(), email: v.optional(v.string()), phone: v.string(),
    contactMethod: v.union(v.literal('text'), v.literal('call'), v.literal('email')),
    eventType: v.string(),
    tripType: v.union(v.literal('pickup'), v.literal('dropoff'), v.literal('both')),
    serviceDate: v.string(), startTime: v.string(), endTime: v.string(),
    pickupAddress: v.string(), destination: v.string(), notes: v.string(), vehicleKey: v.string(),
    paymentAmountCents: v.number()
  },
  handler: async (ctx, { sessionToken, ...args }) => {
    await requireAdmin(ctx, sessionToken)
    return insertBooking(ctx, args, 'admin')
  }
})

export const availabilityForDate = query({
  args: { serviceDate: v.string(), vehicleKey: v.optional(v.string()) },
  handler: async (ctx, { serviceDate, vehicleKey }) => {
    const rows = await ctx.db.query('bookings').withIndex('by_date', q => q.eq('serviceDate', serviceDate)).collect()
    const requested = fleetVehicle(vehicleKey || FLEET[0].key)
    const vehicle = requested ? await ctx.db.query('vehicles').withIndex('by_key', query => query.eq('key', requested.key)).unique() : null
    const active = rows.filter(row => bookingBlocksAvailability(row) && (vehicle ? (!row.vehicleId || row.vehicleId === vehicle._id) : requested?.key === FLEET[0].key ? !row.vehicleId : false))
    const existingPickupTimes = active.map(row => localPickupToUtc(row.serviceDate, row.startTime))
    const unavailableTimes: string[] = []
    for (let minute = 0; minute < 24 * 60; minute += 15) {
      const time = timeFromMinutes(minute)
      try {
        if (capacityIssue(existingPickupTimes, localPickupToUtc(serviceDate, time))) unavailableTimes.push(time)
      } catch {
        unavailableTimes.push(time)
      }
    }
    return { dayFull: active.length >= MAX_DAILY_RESERVATIONS, unavailableTimes }
  }
})

export const adminList = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    await requireAdmin(ctx, sessionToken)
    const rows = await ctx.db.query('bookings').withIndex('by_start').order('desc').collect()
    const vehicles = await ctx.db.query('vehicles').collect()
    return rows.map(row => ({ ...row, vehicle: row.vehicleSnapshot || (row.vehicleId ? vehicles.find(vehicle => vehicle._id === row.vehicleId) : null) || null }))
  }
})

export const updateStatus = mutation({
  args: { sessionToken: v.string(), id: v.id('bookings'), status },
  handler: async (ctx, { sessionToken, id, status: nextStatus }) => {
    const admin = await requireAdmin(ctx, sessionToken)
    const previous = await ctx.db.get(id)
    if (!previous) bookingError('BOOKING_NOT_FOUND', 'Booking not found.')
    await ctx.db.patch(id, { status: nextStatus, updatedAt: Date.now() })
    await ctx.db.insert('auditLogs', { userId: admin.username, action: 'booking_status_changed', entityType: 'booking', entityId: String(id), previousValues: { status: previous!.status }, newValues: { status: nextStatus }, timestamp: Date.now() })
  }
})
