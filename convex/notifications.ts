import { internalAction } from './_generated/server'
import { v } from 'convex/values'

async function sendPushover(title: string, message: string, reference: string) {
  const token = process.env.PUSHOVER_API_TOKEN
  const user = process.env.PUSHOVER_USER_KEY

  if (!token || !user) {
    console.warn(`Pushover notification skipped for ${reference}: missing PUSHOVER_API_TOKEN or PUSHOVER_USER_KEY.`)
    return
  }

  try {
    const response = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, user, title, message, priority: '0' })
    })
    if (!response.ok) {
      console.error(`Pushover notification failed for ${reference} with status ${response.status}`)
      return
    }
    console.log(`Pushover notification accepted for ${reference}`)
  } catch (error) {
    console.error(`Pushover notification request failed for ${reference}: ${error}`)
  }
}

export const sendBooking = internalAction({
  args: {
    bookingId: v.string(),
    confirmationCode: v.string(),
    source: v.union(v.literal('website'), v.literal('admin')),
    fullName: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    contactMethod: v.string(),
    eventType: v.string(),
    tripType: v.string(),
    serviceDate: v.string(),
    startTime: v.string(),
    endTime: v.string(),
    pickupAddress: v.string(),
    destination: v.string(),
    notes: v.optional(v.string()),
    vehicleName: v.optional(v.string())
  },
  handler: async (_ctx, args) => {
    const sourceLabel = args.source === 'admin' ? 'Admin Portal' : 'Website'
    const message = [
      `${args.fullName} created a new chauffeur booking.`,
      `Source: ${sourceLabel}`,
      `Phone: ${args.phone}`,
      args.email ? `Email: ${args.email}` : null,
      `Preferred contact: ${args.contactMethod}`,
      `Occasion: ${args.eventType}`,
      `Trip: ${args.tripType}`,
      args.vehicleName ? `Vehicle: ${args.vehicleName}` : null,
      `When: ${args.serviceDate}, ${args.startTime}–${args.endTime}`,
      `Pickup: ${args.pickupAddress}`,
      `Destination: ${args.destination}`,
      args.notes ? `Notes: ${args.notes}` : null,
      `Confirmation: ${args.confirmationCode}`,
      `Booking ID: ${args.bookingId}`
    ].filter(Boolean).join('\n')

    await sendPushover('New Empire Elite Rides Booking', message, `booking ${args.bookingId}`)
  }
})

export const sendPaidCheckout = internalAction({
  args: {
    stripeEventId: v.string(),
    checkoutSessionId: v.string(),
    amountTotal: v.optional(v.number()),
    currency: v.optional(v.string()),
    bookingId: v.optional(v.string()),
    confirmationCode: v.optional(v.string()),
    livemode: v.boolean()
  },
  handler: async (_ctx, args) => {
    const amount = args.amountTotal === undefined
      ? null
      : `Amount: ${(args.amountTotal / 100).toFixed(2)} ${(args.currency || 'usd').toUpperCase()}`
    const message = [
      'A booking was successfully paid through Stripe Checkout.',
      amount,
      args.confirmationCode ? `Confirmation: ${args.confirmationCode}` : null,
      args.bookingId ? `Booking ID: ${args.bookingId}` : null,
      `Checkout session: ${args.checkoutSessionId}`,
      `Mode: ${args.livemode ? 'live' : 'test'}`
    ].filter(Boolean).join('\n')

    await sendPushover('Empire Elite Rides Booking Paid', message, `Stripe event ${args.stripeEventId}`)
  }
})
