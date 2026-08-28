import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

const bookingStatus = v.union(
  v.literal('payment_pending'), v.literal('requested'), v.literal('manual_review'), v.literal('confirmed'),
  v.literal('completed'), v.literal('cancelled'), v.literal('refunded')
)

const paymentStatus = v.union(
  v.literal('not_required'), v.literal('checkout_pending'), v.literal('paid'),
  v.literal('failed'), v.literal('expired'), v.literal('refunded')
)

export default defineSchema({
  bookings: defineTable({
    confirmationCode: v.string(),
    fullName: v.string(),
    email: v.optional(v.string()),
    phone: v.string(),
    contactMethod: v.union(v.literal('text'), v.literal('call'), v.literal('email')),
    eventCategory: v.optional(v.string()),
    eventType: v.string(),
    tripType: v.union(v.literal('pickup'), v.literal('dropoff'), v.literal('both')),
    serviceDate: v.string(), startTime: v.string(), endTime: v.string(),
    startAt: v.number(), endAt: v.number(),
    pickupAddress: v.string(), destination: v.string(), notes: v.string(),
    source: v.optional(v.union(v.literal('website'), v.literal('admin'))),
    status: bookingStatus,
    customerSessionId: v.optional(v.string()),
    paymentStatus: v.optional(paymentStatus),
    paymentAmountCents: v.optional(v.number()),
    paymentCurrency: v.optional(v.string()),
    paymentExpiresAt: v.optional(v.number()),
    paidAt: v.optional(v.number()),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripeCheckoutUrl: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    quoteId: v.optional(v.id('rideQuotes')),
    estimateId: v.optional(v.id('rideEstimates')),
    promotionId: v.optional(v.id('promotions')),
    vehicleId: v.optional(v.id('vehicles')),
    vehicleSnapshot: v.optional(v.any()),
    routeSnapshot: v.optional(v.any()), pricingSnapshot: v.optional(v.any()), promotionSnapshot: v.optional(v.any()),
    createdAt: v.number(), updatedAt: v.number()
  }).index('by_start', ['startAt'])
    .index('by_date', ['serviceDate'])
    .index('by_status', ['status'])
    .index('by_quote', ['quoteId'])
    .index('by_payment_status', ['paymentStatus'])
    .index('by_stripe_checkout_session', ['stripeCheckoutSessionId']),

  adminSessions: defineTable({
    tokenHash: v.string(),
    username: v.string(), role: v.optional(v.string()),
    expiresAt: v.number(), createdAt: v.number(),
    lastActiveAt: v.number()
  }).index('by_token_hash', ['tokenHash']),

  adminUsers: defineTable({
    username: v.string(), role: v.union(v.literal('owner'), v.literal('admin'), v.literal('manager'), v.literal('dispatcher'), v.literal('viewer')),
    active: v.boolean(), createdAt: v.number(), updatedAt: v.number()
  }).index('by_username', ['username']).index('by_active', ['active']),

  vehicles: defineTable({
    key: v.optional(v.string()), name: v.string(), make: v.string(), model: v.string(), year: v.number(),
    vehicleClass: v.optional(v.string()), powertrain: v.optional(v.string()), color: v.optional(v.string()),
    passengerCapacity: v.optional(v.number()), luggageCapacity: v.optional(v.number()),
    description: v.optional(v.string()), imageUrl: v.optional(v.string()), sortOrder: v.optional(v.number()),
    active: v.boolean(), createdAt: v.number(), updatedAt: v.number()
  }).index('by_active', ['active']).index('by_key', ['key']),

  operatingBases: defineTable({
    name: v.string(), address: v.string(), formattedAddress: v.string(),
    placeId: v.string(), latitude: v.number(), longitude: v.number(),
    timezone: v.string(), active: v.boolean(), createdAt: v.number(), updatedAt: v.number()
  }).index('by_active', ['active']),

  pricingConfigs: defineTable({
    version: v.number(), effectiveAt: v.number(), createdBy: v.string(), createdAt: v.number(),
    snapshot: v.any(), active: v.boolean()
  }).index('by_active', ['active']).index('by_version', ['version']),

  holidayRules: defineTable({
    name: v.string(), startAt: v.number(), endAt: v.number(), flatCents: v.number(),
    percentageBps: v.number(), manualApproval: v.boolean(), notes: v.optional(v.string()),
    active: v.boolean(), createdAt: v.number(), updatedAt: v.number()
  }).index('by_active', ['active']).index('by_start', ['startAt']),

  specialEventRules: defineTable({
    name: v.string(), startAt: v.number(), endAt: v.number(), radiusMiles: v.optional(v.number()),
    centerLatitude: v.optional(v.number()), centerLongitude: v.optional(v.number()),
    pickupCondition: v.optional(v.string()), dropoffCondition: v.optional(v.string()),
    flatCents: v.number(), percentageBps: v.number(), manualApproval: v.boolean(),
    displayName: v.boolean(), active: v.boolean(), createdAt: v.number(), updatedAt: v.number()
  }).index('by_active', ['active']).index('by_start', ['startAt']),

  promotions: defineTable({
    code: v.string(), flatDiscountCents: v.number(), percentageBps: v.number(),
    maximumDiscountCents: v.number(), minimumBookingCents: v.number(), startAt: v.number(), endAt: v.number(),
    usageLimit: v.number(), uses: v.number(), serviceTypes: v.array(v.string()),
    allowBelowMinimum: v.boolean(), active: v.boolean(), createdAt: v.number(), updatedAt: v.number(),
    kind: v.optional(v.union(v.literal('code'), v.literal('automatic'))),
    name: v.optional(v.string()), publicHeadline: v.optional(v.string()), publicMessage: v.optional(v.string()),
    createdBy: v.optional(v.string())
  }).index('by_code', ['code']).index('by_active', ['active']).index('by_kind_active', ['kind', 'active']),

  promotionRedemptions: defineTable({
    promotionId: v.id('promotions'), quoteId: v.id('rideQuotes'), bookingId: v.id('bookings'),
    discountCents: v.number(), createdAt: v.number()
  }).index('by_promotion', ['promotionId']).index('by_quote', ['quoteId']).index('by_booking', ['bookingId']),

  rideEstimates: defineTable({
    sessionId: v.string(), pickupPlaceId: v.string(), pickupAddress: v.string(), pickupCoordinates: v.any(),
    dropoffPlaceId: v.string(), dropoffAddress: v.string(), dropoffCoordinates: v.any(),
    pickupDate: v.string(), dropoffDate: v.optional(v.string()), pickupTime: v.string(), scheduledPickupAt: v.number(), timezone: v.string(),
    operatingBaseId: v.id('operatingBases'), vehicleId: v.id('vehicles'),
    routeSnapshot: v.any(), trafficSnapshot: v.any(), availabilitySnapshot: v.any(), demandSnapshot: v.any(),
    pricingBreakdown: v.any(), estimatedPriceCents: v.number(), pricingConfigVersion: v.number(),
    status: v.union(v.literal('quoted'), v.literal('confirmation_required'), v.literal('unavailable'), v.literal('expired'), v.literal('converted')),
    createdAt: v.number(), expiresAt: v.number()
  }).index('by_session', ['sessionId']).index('by_expiration', ['expiresAt']).index('by_status', ['status']),

  rideQuotes: defineTable({
    customerSessionId: v.string(), estimateId: v.optional(v.id('rideEstimates')),
    scheduledPickupAt: v.number(), expectedEndAt: v.number(), tripType: v.string(),
    passengerCount: v.number(), luggageCount: v.number(), requestInputs: v.any(),
    routeSnapshot: v.any(), availabilitySnapshot: v.any(), demandSnapshot: v.any(), pricingBreakdown: v.any(),
    subtotalCents: v.number(), discountCents: v.number(), taxCents: v.number(), gratuityCents: v.number(),
    tollEstimateCents: v.number(), finalPriceCents: v.number(), pricingConfigVersion: v.number(),
    pricingSnapshot: v.any(), quoteHash: v.string(),
    promotionId: v.optional(v.id('promotions')), promotionSnapshot: v.optional(v.any()),
    vehicleId: v.optional(v.id('vehicles')), vehicleSnapshot: v.optional(v.any()),
    status: v.union(v.literal('instant_quote'), v.literal('manual_review_required'), v.literal('approved'), v.literal('rejected'), v.literal('expired'), v.literal('converted')),
    createdAt: v.number(), expiresAt: v.number()
  }).index('by_session', ['customerSessionId']).index('by_expiration', ['expiresAt']).index('by_status', ['status']),

  blackoutPeriods: defineTable({
    vehicleId: v.optional(v.id('vehicles')), startAt: v.number(), endAt: v.number(), reason: v.string(),
    active: v.boolean(), createdBy: v.string(), createdAt: v.number(), updatedAt: v.number()
  }).index('by_start', ['startAt']).index('by_active', ['active']),

  addressSelections: defineTable({
    sessionId: v.string(), placeId: v.string(), formattedAddress: v.string(),
    latitude: v.number(), longitude: v.number(), city: v.string(), state: v.string(),
    postalCode: v.string(), country: v.string(), expiresAt: v.number(), createdAt: v.number()
  }).index('by_session_place', ['sessionId', 'placeId']).index('by_expiration', ['expiresAt']),

  rateLimits: defineTable({ key: v.string(), windowStartedAt: v.number(), count: v.number() }).index('by_key', ['key']),

  auditLogs: defineTable({
    userId: v.string(), action: v.string(), entityType: v.string(), entityId: v.string(),
    previousValues: v.optional(v.any()), newValues: v.optional(v.any()), reason: v.optional(v.string()), timestamp: v.number()
  }).index('by_timestamp', ['timestamp']).index('by_entity', ['entityType', 'entityId']),

  stripeWebhookEvents: defineTable({
    stripeEventId: v.string(),
    eventType: v.string(),
    stripeCreatedAt: v.number(),
    livemode: v.boolean(),
    checkoutSessionId: v.string(),
    paymentStatus: v.optional(v.string()),
    bookingId: v.optional(v.id('bookings')),
    amountTotal: v.optional(v.number()),
    currency: v.optional(v.string()),
    processingStatus: v.union(
      v.literal('received'), v.literal('processed'), v.literal('ignored'),
      v.literal('unmatched'), v.literal('amount_mismatch')
    ),
    notificationStatus: v.optional(v.union(v.literal('not_required'), v.literal('scheduled'))),
    receivedAt: v.number()
  }).index('by_event_id', ['stripeEventId'])
})
