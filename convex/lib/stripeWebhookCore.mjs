export async function processCheckoutCompleted(ctx, event, paidNotification) {
  const existingEvent = await ctx.db
    .query('stripeWebhookEvents')
    .withIndex('by_event_id', query => query.eq('stripeEventId', event.stripeEventId))
    .unique()
  if (existingEvent) return { duplicate: true, processingStatus: existingEvent.processingStatus }

  let booking = await ctx.db
    .query('bookings')
    .withIndex('by_stripe_checkout_session', query => query.eq('stripeCheckoutSessionId', event.checkoutSessionId))
    .unique()

  const metadataBookingId = event.bookingId ? ctx.db.normalizeId('bookings', event.bookingId) : null
  if (!booking && metadataBookingId) booking = await ctx.db.get(metadataBookingId)

  const metadataMismatch = Boolean(booking && metadataBookingId && booking._id !== metadataBookingId)
  const sessionMismatch = Boolean(booking?.stripeCheckoutSessionId && booking.stripeCheckoutSessionId !== event.checkoutSessionId)
  const confirmationMismatch = Boolean(event.confirmationCode && booking && booking.confirmationCode !== event.confirmationCode)
  const referenceValid = Boolean(booking && !metadataMismatch && !sessionMismatch && !confirmationMismatch)
  const amountValid = Boolean(
    referenceValid &&
    Number.isInteger(event.amountTotal) &&
    event.amountTotal === booking.paymentAmountCents &&
    event.currency?.toLowerCase() === booking.paymentCurrency?.toLowerCase()
  )
  const isPaid = event.paymentStatus === 'paid'
  const shouldMarkPaid = Boolean(amountValid && isPaid)
  const shouldNotify = Boolean(shouldMarkPaid && booking.paymentStatus !== 'paid')

  const processingStatus = !referenceValid
    ? 'unmatched'
    : !amountValid
      ? 'amount_mismatch'
      : !isPaid
        ? 'ignored'
        : 'processed'

  await ctx.db.insert('stripeWebhookEvents', {
    stripeEventId: event.stripeEventId,
    eventType: event.eventType,
    stripeCreatedAt: event.stripeCreatedAt,
    livemode: event.livemode,
    checkoutSessionId: event.checkoutSessionId,
    paymentStatus: event.paymentStatus,
    bookingId: referenceValid ? booking._id : undefined,
    amountTotal: event.amountTotal,
    currency: event.currency,
    processingStatus,
    notificationStatus: shouldNotify ? 'scheduled' : 'not_required',
    receivedAt: Date.now()
  })

  if (shouldMarkPaid) {
    await ctx.db.patch(booking._id, {
      status: booking.status === 'payment_pending' ? 'requested' : booking.status,
      paymentStatus: 'paid',
      paidAt: event.stripeCreatedAt * 1000,
      stripeCheckoutSessionId: event.checkoutSessionId,
      stripePaymentIntentId: event.paymentIntentId,
      stripeCustomerId: event.stripeCustomerId,
      updatedAt: Date.now()
    })
  }

  // The event insert, booking transition, and schedule are committed in one
  // Convex transaction. A replay or second paid event cannot notify twice.
  if (shouldNotify) {
    await ctx.scheduler.runAfter(0, paidNotification, {
      stripeEventId: event.stripeEventId,
      checkoutSessionId: event.checkoutSessionId,
      amountTotal: booking.paymentAmountCents,
      currency: booking.paymentCurrency,
      bookingId: String(booking._id),
      confirmationCode: booking.confirmationCode,
      livemode: event.livemode
    })
  }

  return { duplicate: false, processingStatus, bookingId: referenceValid ? booking._id : null, notified: shouldNotify }
}
