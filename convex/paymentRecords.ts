import { internalMutation, query } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { localParts } from './lib/time'
import { bookingBlocksAvailability } from './lib/bookingState'

const customerValidator = v.object({
  fullName: v.string(), email: v.string(), phone: v.string(),
  contactMethod: v.union(v.literal('text'), v.literal('call'), v.literal('email')),
  eventType: v.string(), notes: v.string()
})

const fail = (code: string, message: string): never => { throw new ConvexError({ code, message }) }
const confirmationCode = () => `EER-${Date.now().toString(36).slice(-6).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`

async function releasePromotionUse(ctx: any, booking: any) {
  const redemption = await ctx.db.query('promotionRedemptions').withIndex('by_booking', (query: any) => query.eq('bookingId', booking._id)).unique()
  if (!redemption) return
  const promotion = await ctx.db.get(redemption.promotionId)
  await ctx.db.delete(redemption._id)
  if (promotion) await ctx.db.patch(promotion._id, { uses: Math.max(0, promotion.uses - 1), updatedAt: Date.now() })
}

function validateCustomer(customer: any) {
  if (customer.fullName.trim().length < 2 || !customer.email.includes('@') || customer.phone.replace(/\D/g, '').length !== 10 || !customer.eventType) {
    fail('INVALID_CUSTOMER', 'Complete the required customer details.')
  }
}

export const prepareCheckout = internalMutation({
  args: { quoteId: v.id('rideQuotes'), sessionId: v.string(), customer: customerValidator },
  handler: async (ctx, args) => {
    validateCustomer(args.customer)
    const now = Date.now()
    const rawQuote = await ctx.db.get(args.quoteId)
    if (!rawQuote) fail('QUOTE_EXPIRED', 'Recalculate this request before paying.')
    const quote = rawQuote!
    if (quote.customerSessionId !== args.sessionId) fail('QUOTE_EXPIRED', 'Recalculate this request before paying.')

    const existing = await ctx.db.query('bookings').withIndex('by_quote', query => query.eq('quoteId', args.quoteId)).first()
    if (existing) {
      if (existing.customerSessionId !== args.sessionId) fail('BOOKING_NOT_FOUND', 'This payment session is not available.')
      if (existing.paymentStatus === 'paid') fail('ALREADY_PAID', 'This reservation is already paid.')
      if (existing.paymentStatus === 'checkout_pending' && existing.paymentExpiresAt && existing.paymentExpiresAt > now) {
        return {
          bookingId: existing._id, confirmationCode: existing.confirmationCode,
          email: existing.email!, amountCents: existing.paymentAmountCents!, currency: existing.paymentCurrency!,
          paymentExpiresAt: existing.paymentExpiresAt, promotion: existing.promotionSnapshot
        }
      }
      fail('CHECKOUT_EXPIRED', 'This payment session expired. Recalculate the trip to continue.')
    }

    if (quote.expiresAt <= now || !['instant_quote', 'approved'].includes(quote.status)) {
      if (quote.status === 'manual_review_required') fail('CHECKOUT_REQUIRES_REVIEW', 'This trip requires staff confirmation before payment.')
      fail('QUOTE_EXPIRED', 'Recalculate this request before paying.')
    }

    let promotion = null
    if (quote.promotionId && quote.discountCents > 0) {
      const rawPromotion = await ctx.db.get(quote.promotionId)
      if (!rawPromotion || !rawPromotion.active || rawPromotion.uses >= rawPromotion.usageLimit) {
        fail('PROMOTION_UNAVAILABLE', 'That promotion is no longer available. Recalculate your price to continue.')
      }
      promotion = rawPromotion
    }

    const activeBookings = (await ctx.db.query('bookings').collect()).filter(row => bookingBlocksAvailability(row, now))
    const activeBlocks = await ctx.db.query('blackoutPeriods').withIndex('by_active', query => query.eq('active', true)).collect()
    const conflict = [
      ...activeBookings.map(row => ({ startAt: row.startAt, endAt: row.endAt })),
      ...activeBlocks.map(row => ({ startAt: row.startAt, endAt: row.endAt }))
    ].some(row => quote.scheduledPickupAt < row.endAt && quote.expectedEndAt > row.startAt)
    if (conflict) fail('TIME_UNAVAILABLE', 'That pickup time is no longer available. Choose another time.')

    const start = localParts(quote.scheduledPickupAt)
    const end = localParts(quote.expectedEndAt)
    const code = confirmationCode()
    const paymentExpiresAt = now + 30 * 60 * 1000
    const airport = quote.requestInputs.airportOptions
    const airportNote = airport ? `Airport ${airport.direction}: ${airport.airline}, flight ${airport.flightNumber}` : ''
    const bookingNotes = [airportNote, args.customer.notes.trim()].filter(Boolean).join(' · ')
    const bookingId = await ctx.db.insert('bookings', {
      confirmationCode: code,
      fullName: args.customer.fullName.trim(),
      email: args.customer.email.trim().toLowerCase(),
      phone: args.customer.phone.trim(),
      contactMethod: args.customer.contactMethod,
      eventType: args.customer.eventType,
      tripType: quote.tripType === 'round_trip' ? 'both' : 'pickup',
      serviceDate: start.date, startTime: start.time, endTime: end.time,
      startAt: quote.scheduledPickupAt, endAt: quote.expectedEndAt,
      pickupAddress: quote.requestInputs.pickup.address,
      destination: quote.requestInputs.dropoff.address,
      notes: bookingNotes, source: 'website', status: 'payment_pending',
      customerSessionId: args.sessionId,
      paymentStatus: 'checkout_pending', paymentAmountCents: quote.finalPriceCents,
      paymentCurrency: 'usd', paymentExpiresAt,
      quoteId: quote._id, estimateId: quote.estimateId,
      promotionId: quote.promotionId,
      routeSnapshot: quote.routeSnapshot,
      promotionSnapshot: quote.promotionSnapshot,
      pricingSnapshot: {
        version: quote.pricingConfigVersion,
        quotedPriceCents: quote.finalPriceCents,
        promotion: quote.promotionSnapshot,
        discountCents: quote.discountCents,
        customerBreakdown: quote.pricingBreakdown.customer
      },
      createdAt: now, updatedAt: now
    })
    if (promotion && quote.promotionId) {
      await ctx.db.insert('promotionRedemptions', { promotionId: quote.promotionId, quoteId: quote._id, bookingId, discountCents: quote.discountCents, createdAt: now })
      await ctx.db.patch(quote.promotionId, { uses: promotion.uses + 1, updatedAt: now })
    }
    await ctx.db.patch(quote._id, { status: 'converted' })
    return {
      bookingId, confirmationCode: code, email: args.customer.email.trim().toLowerCase(),
      amountCents: quote.finalPriceCents, currency: 'usd', paymentExpiresAt,
      promotion: quote.promotionSnapshot
    }
  }
})

export const attachCheckoutSession = internalMutation({
  args: {
    bookingId: v.id('bookings'), checkoutSessionId: v.string(),
    amountCents: v.number(), currency: v.string()
  },
  handler: async (ctx, args) => {
    const rawBooking = await ctx.db.get(args.bookingId)
    if (!rawBooking) fail('PAYMENT_INTEGRITY_ERROR', 'The secure payment could not be prepared.')
    const booking = rawBooking!
    if (booking.paymentAmountCents !== args.amountCents || booking.paymentCurrency !== args.currency.toLowerCase()) {
      fail('PAYMENT_INTEGRITY_ERROR', 'The secure payment could not be prepared.')
    }
    if (booking.stripeCheckoutSessionId && booking.stripeCheckoutSessionId !== args.checkoutSessionId) {
      fail('PAYMENT_INTEGRITY_ERROR', 'The secure payment could not be prepared.')
    }
    await ctx.db.patch(args.bookingId, { stripeCheckoutSessionId: args.checkoutSessionId, updatedAt: Date.now() })
  }
})

export const releaseFailedCheckout = internalMutation({
  args: { bookingId: v.id('bookings') },
  handler: async (ctx, { bookingId }) => {
    const booking = await ctx.db.get(bookingId)
    if (!booking || booking.stripeCheckoutSessionId || booking.paymentStatus !== 'checkout_pending') return
    await releasePromotionUse(ctx, booking)
    await ctx.db.patch(bookingId, { paymentStatus: 'failed', status: 'cancelled', updatedAt: Date.now() })
  }
})

export const expirePendingCheckouts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const pending = await ctx.db.query('bookings').withIndex('by_payment_status', query => query.eq('paymentStatus', 'checkout_pending')).collect()
    let expired = 0
    for (const booking of pending) {
      if (booking.paymentExpiresAt && booking.paymentExpiresAt <= now) {
        await releasePromotionUse(ctx, booking)
        await ctx.db.patch(booking._id, { paymentStatus: 'expired', status: 'cancelled', updatedAt: now })
        expired += 1
      }
    }
    return expired
  }
})

export const checkoutStatus = query({
  args: { checkoutSessionId: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const booking = await ctx.db.query('bookings')
      .withIndex('by_stripe_checkout_session', query => query.eq('stripeCheckoutSessionId', args.checkoutSessionId))
      .unique()
    if (!booking || booking.customerSessionId !== args.sessionId) return null
    return {
      confirmationCode: booking.confirmationCode,
      paymentStatus: booking.paymentStatus || 'not_required',
      amountCents: booking.paymentAmountCents,
      currency: booking.paymentCurrency,
      bookingStatus: booking.status
    }
  }
})
