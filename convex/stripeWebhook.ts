import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'
import { processCheckoutCompleted } from './lib/stripeWebhookCore.mjs'

const internalApi: any = internal

export const recordCheckoutCompleted = internalMutation({
  args: {
    stripeEventId: v.string(),
    eventType: v.string(),
    stripeCreatedAt: v.number(),
    livemode: v.boolean(),
    checkoutSessionId: v.string(),
    paymentStatus: v.optional(v.string()),
    amountTotal: v.optional(v.number()),
    currency: v.optional(v.string()),
    bookingId: v.optional(v.string()),
    confirmationCode: v.optional(v.string()),
    paymentIntentId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string())
  },
  handler: async (ctx, event): Promise<any> => processCheckoutCompleted(ctx, event, internalApi.notifications.sendPaidCheckout)
})
