import { mutation } from './_generated/server'
import { internal } from './_generated/api'
import { ConvexError, v } from 'convex/values'
import { localParts, localPickupToUtc } from './lib/time'
import { bookingBlocksAvailability } from './lib/bookingState'

const customerValidator = v.object({
  fullName: v.string(), email: v.string(), phone: v.string(),
  contactMethod: v.union(v.literal('text'), v.literal('call'), v.literal('email')),
  eventType: v.string(), notes: v.string()
})

const fail = (code: string, message: string): never => { throw new ConvexError({ code, message }) }
const confirmationCode = () => `EER-${Date.now().toString(36).slice(-6).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`

function validateCustomer(customer: any) {
  if (customer.fullName.trim().length < 2 || !customer.email.includes('@') || customer.phone.replace(/\D/g, '').length !== 10 || !customer.eventType) fail('INVALID_CUSTOMER', 'Complete the required customer details.')
}

export const submit = mutation({
  args: { quoteId: v.id('rideQuotes'), sessionId: v.string(), customer: customerValidator },
  handler: async (ctx, args) => {
    validateCustomer(args.customer)
    const now = Date.now()
    const rawQuote = await ctx.db.get(args.quoteId)
    if (!rawQuote) fail('QUOTE_EXPIRED', 'Recalculate this request before submitting it.')
    const quote = rawQuote!
    if (quote.customerSessionId !== args.sessionId || quote.expiresAt <= now || !['instant_quote', 'manual_review_required', 'approved'].includes(quote.status)) fail('QUOTE_EXPIRED', 'Recalculate this request before submitting it.')

    const activeBookings = (await ctx.db.query('bookings').collect()).filter(row => bookingBlocksAvailability(row, now))
    const activeBlocks = await ctx.db.query('blackoutPeriods').withIndex('by_active', q => q.eq('active', true)).collect()
    const conflict = [
      ...activeBookings.map(row => ({ startAt: localPickupToUtc(row.serviceDate, row.startTime), endAt: localPickupToUtc(row.serviceDate, row.endTime) })),
      ...activeBlocks.map(row => ({ startAt: row.startAt, endAt: row.endAt }))
    ].some(row => quote.scheduledPickupAt < row.endAt && quote.expectedEndAt > row.startAt)
    if (conflict) fail('TIME_UNAVAILABLE', 'That pickup time is no longer available. Choose another time.')

    const start = localParts(quote.scheduledPickupAt), end = localParts(quote.expectedEndAt), code = confirmationCode()
    const needsReview = quote.status === 'manual_review_required'
    const airport = quote.requestInputs.airportOptions
    const airportNote = airport ? `Airport ${airport.direction}: ${airport.airline}, flight ${airport.flightNumber}` : ''
    const bookingNotes = [airportNote, args.customer.notes.trim()].filter(Boolean).join(' · ')
    const bookingId = await ctx.db.insert('bookings', {
      confirmationCode: code, fullName: args.customer.fullName.trim(), email: args.customer.email.trim().toLowerCase(), phone: args.customer.phone.trim(), contactMethod: args.customer.contactMethod,
      eventType: args.customer.eventType, tripType: quote.tripType === 'round_trip' ? 'both' : 'pickup', serviceDate: start.date, startTime: start.time, endTime: end.time,
      startAt: quote.scheduledPickupAt, endAt: quote.expectedEndAt, pickupAddress: quote.requestInputs.pickup.address, destination: quote.requestInputs.dropoff.address,
      notes: bookingNotes, source: 'website', status: needsReview ? 'manual_review' : 'requested', quoteId: quote._id, estimateId: quote.estimateId,
      customerSessionId: args.sessionId, paymentStatus: 'not_required',
      routeSnapshot: quote.routeSnapshot, pricingSnapshot: { version: quote.pricingConfigVersion, quotedPriceCents: quote.finalPriceCents, customerBreakdown: quote.pricingBreakdown.customer },
      createdAt: now, updatedAt: now
    })
    await ctx.db.patch(quote._id, { status: 'converted' })
    await ctx.scheduler.runAfter(0, internal.notifications.sendBooking, {
      bookingId: String(bookingId), confirmationCode: code, source: 'website', fullName: args.customer.fullName.trim(),
      phone: args.customer.phone.trim(), email: args.customer.email.trim().toLowerCase(), contactMethod: args.customer.contactMethod,
      eventType: args.customer.eventType, tripType: quote.tripType, serviceDate: start.date, startTime: start.time, endTime: end.time,
      pickupAddress: quote.requestInputs.pickup.address, destination: quote.requestInputs.dropoff.address, notes: bookingNotes || undefined
    })
    return { confirmationCode: code, status: needsReview ? 'manual_review' : 'requested' }
  }
})
