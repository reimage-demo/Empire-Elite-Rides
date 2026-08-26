import Stripe from 'stripe'
import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'

const http = httpRouter()
const internalApi: any = internal

// This client never calls Stripe's API. It only exposes the SDK's webhook verifier.
const stripe = new Stripe('webhook_signature_verification_only')

http.route({
  path: '/stripe/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
    if (!webhookSecret) {
      console.error('Stripe webhook is not configured: STRIPE_WEBHOOK_SECRET is missing')
      return new Response('Webhook is not configured', { status: 500 })
    }

    const signature = request.headers.get('stripe-signature')
    if (!signature) return new Response('Missing Stripe signature', { status: 400 })

    // Stripe signature verification requires the exact, unparsed request body.
    const rawBody = await request.text()
    let event: Stripe.Event
    try {
      event = await stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        webhookSecret,
        undefined,
        Stripe.createSubtleCryptoProvider()
      )
    } catch {
      console.warn('Stripe webhook signature verification failed')
      return new Response('Invalid Stripe signature', { status: 400 })
    }

    if (event.type !== 'checkout.session.completed') {
      return new Response('Event type ignored', { status: 200 })
    }

    const session = event.data.object as Stripe.Checkout.Session
    await ctx.runMutation(internalApi.stripeWebhook.recordCheckoutCompleted, {
      stripeEventId: event.id,
      eventType: event.type,
      stripeCreatedAt: event.created,
      livemode: event.livemode,
      checkoutSessionId: session.id,
      paymentStatus: session.payment_status || undefined,
      amountTotal: session.amount_total ?? undefined,
      currency: session.currency || undefined,
      bookingId: session.metadata?.bookingId || undefined,
      confirmationCode: session.metadata?.confirmationCode || undefined,
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id
    })

    return new Response('Webhook received', { status: 200 })
  })
})

export default http
