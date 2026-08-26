'use node'

import Stripe from 'stripe'
import { action } from './_generated/server'
import { internal } from './_generated/api'
import { ConvexError, v } from 'convex/values'

const internalApi: any = internal

function safeReturnOrigin(value: string) {
  let url: URL
  try { url = new URL(value) } catch { throw new ConvexError({ code: 'INVALID_RETURN_URL', message: 'The secure payment return address is invalid.' }) }
  const productionHost = url.protocol === 'https:' && ['empireeliterides.com', 'www.empireeliterides.com'].includes(url.hostname)
  const localHost = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (!productionHost && !localHost) throw new ConvexError({ code: 'INVALID_RETURN_URL', message: 'The secure payment return address is invalid.' })
  return url.origin
}

function safeAdminReturnUrl(value: string) {
  let url: URL
  try { url = new URL(value) } catch { throw new ConvexError({ code: 'INVALID_RETURN_URL', message: 'The secure payment return address is invalid.' }) }
  const production = url.protocol === 'https:' && url.hostname === 'reimage-demo.github.io' && url.pathname.toLowerCase().startsWith('/admin-empire-elite-rides/')
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (!production && !local) throw new ConvexError({ code: 'INVALID_RETURN_URL', message: 'The secure payment return address is invalid.' })
  url.search = ''
  url.hash = ''
  return url.toString()
}

export const createCheckout = action({
  args: {
    quoteId: v.id('rideQuotes'), sessionId: v.string(), returnOrigin: v.string(),
    customer: v.object({
      fullName: v.string(), email: v.string(), phone: v.string(),
      contactMethod: v.union(v.literal('text'), v.literal('call'), v.literal('email')),
      eventType: v.string(), notes: v.string()
    })
  },
  handler: async (ctx, args) => {
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) throw new ConvexError({ code: 'PAYMENTS_NOT_CONFIGURED', message: 'Secure online payment is being configured. Please try again later.' })

    await ctx.runMutation(internalApi.quotes.consumeRateLimit, { key: `checkout:${args.sessionId}`, limit: 8, windowMs: 60000 })
    const booking = await ctx.runMutation(internalApi.paymentRecords.prepareCheckout, {
      quoteId: args.quoteId, sessionId: args.sessionId, customer: args.customer
    })
    const returnOrigin = safeReturnOrigin(args.returnOrigin)
    const stripe = new Stripe(secretKey)
    const promotionDescription = booking.promotion?.name ? ` · ${booking.promotion.name}` : ''
    const checkoutMetadata: Record<string, string> = {
      bookingId: String(booking.bookingId),
      confirmationCode: booking.confirmationCode,
      quoteId: String(args.quoteId)
    }
    if (booking.promotion?.name) checkoutMetadata.promotion = String(booking.promotion.name)
    if (booking.promotion?.code) checkoutMetadata.promotionCode = String(booking.promotion.code)
    let checkout: Stripe.Checkout.Session
    try {
      checkout = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: booking.email,
        client_reference_id: String(booking.bookingId),
        line_items: [{
          quantity: 1,
          price_data: {
            currency: booking.currency,
            unit_amount: booking.amountCents,
            product_data: {
              name: 'Empire Elite Rides chauffeur reservation',
              description: `Reservation ${booking.confirmationCode}${promotionDescription}`
            }
          }
        }],
        metadata: checkoutMetadata,
        payment_intent_data: {
          metadata: {
            bookingId: String(booking.bookingId),
            confirmationCode: booking.confirmationCode
          }
        },
        success_url: `${returnOrigin}/booking.html?payment=success&checkout_session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnOrigin}/booking.html?payment=cancelled`,
        expires_at: Math.floor(booking.paymentExpiresAt / 1000)
      }, { idempotencyKey: `eer-checkout-${booking.bookingId}` })
    } catch {
      await ctx.runMutation(internalApi.paymentRecords.releaseFailedCheckout, { bookingId: booking.bookingId })
      throw new ConvexError({ code: 'CHECKOUT_UNAVAILABLE', message: 'Stripe Checkout could not be opened. Please try again.' })
    }

    if (!checkout.url || checkout.amount_total !== booking.amountCents || checkout.currency !== booking.currency) {
      await ctx.runMutation(internalApi.paymentRecords.releaseFailedCheckout, { bookingId: booking.bookingId })
      throw new ConvexError({ code: 'PAYMENT_INTEGRITY_ERROR', message: 'The secure payment could not be prepared.' })
    }
    await ctx.runMutation(internalApi.paymentRecords.attachCheckoutSession, {
      bookingId: booking.bookingId,
      checkoutSessionId: checkout.id,
      checkoutUrl: checkout.url,
      amountCents: booking.amountCents,
      currency: booking.currency
    })
    return {
      checkoutUrl: checkout.url,
      checkoutSessionId: checkout.id,
      confirmationCode: booking.confirmationCode,
      amountCents: booking.amountCents,
      testMode: !checkout.livemode
    }
  }
})

export const createAdminCheckout = action({
  args: { sessionToken: v.string(), bookingId: v.id('bookings'), returnUrl: v.string() },
  handler: async (ctx, args) => {
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) throw new ConvexError({ code: 'PAYMENTS_NOT_CONFIGURED', message: 'Secure online payment is being configured. Please try again later.' })
    const booking = await ctx.runMutation(internalApi.paymentRecords.prepareAdminCheckout, {
      sessionToken: args.sessionToken, bookingId: args.bookingId
    })
    if (booking.checkoutUrl) return {
      checkoutUrl: booking.checkoutUrl, confirmationCode: booking.confirmationCode,
      amountCents: booking.amountCents, testMode: secretKey.startsWith('sk_test_')
    }
    const returnUrl = safeAdminReturnUrl(args.returnUrl)
    const stripe = new Stripe(secretKey)
    let checkout: Stripe.Checkout.Session
    try {
      checkout = await stripe.checkout.sessions.create({
        mode: 'payment', payment_method_types: ['card'],
        customer_email: booking.email || undefined,
        client_reference_id: String(booking.bookingId),
        line_items: [{
          quantity: 1,
          price_data: {
            currency: booking.currency, unit_amount: booking.amountCents,
            product_data: { name: 'Empire Elite Rides chauffeur reservation', description: `Reservation ${booking.confirmationCode}` }
          }
        }],
        metadata: { bookingId: String(booking.bookingId), confirmationCode: booking.confirmationCode, source: 'admin' },
        payment_intent_data: { metadata: { bookingId: String(booking.bookingId), confirmationCode: booking.confirmationCode, source: 'admin' } },
        success_url: `${returnUrl}?adminPayment=success&checkout_session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnUrl}?adminPayment=cancelled`,
        expires_at: Math.floor(booking.paymentExpiresAt / 1000)
      }, { idempotencyKey: `eer-admin-checkout-${booking.bookingId}-${booking.paymentExpiresAt}` })
    } catch {
      await ctx.runMutation(internalApi.paymentRecords.releaseFailedCheckout, { bookingId: booking.bookingId })
      throw new ConvexError({ code: 'CHECKOUT_UNAVAILABLE', message: 'Stripe Checkout could not be opened. The booking is still confirmed; try generating the link again.' })
    }
    if (!checkout.url || checkout.amount_total !== booking.amountCents || checkout.currency !== booking.currency) {
      await ctx.runMutation(internalApi.paymentRecords.releaseFailedCheckout, { bookingId: booking.bookingId })
      throw new ConvexError({ code: 'PAYMENT_INTEGRITY_ERROR', message: 'The secure payment could not be prepared.' })
    }
    await ctx.runMutation(internalApi.paymentRecords.attachCheckoutSession, {
      bookingId: booking.bookingId, checkoutSessionId: checkout.id, checkoutUrl: checkout.url,
      amountCents: booking.amountCents, currency: booking.currency
    })
    return {
      checkoutUrl: checkout.url, checkoutSessionId: checkout.id,
      confirmationCode: booking.confirmationCode, amountCents: booking.amountCents,
      testMode: !checkout.livemode
    }
  }
})
