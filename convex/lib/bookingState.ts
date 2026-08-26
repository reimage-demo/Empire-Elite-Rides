export function bookingBlocksAvailability(booking: any, now = Date.now()) {
  if (['cancelled', 'refunded'].includes(booking.status)) return false
  return !(booking.paymentStatus === 'checkout_pending' && booking.paymentExpiresAt && booking.paymentExpiresAt <= now)
}
