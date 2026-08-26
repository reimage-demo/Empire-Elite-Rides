export function bookingBlocksAvailability(booking: any, now = Date.now()) {
  if (['cancelled', 'refunded'].includes(booking.status)) return false
  if (booking.source === 'admin') return true
  return !(booking.paymentStatus === 'checkout_pending' && booking.paymentExpiresAt && booking.paymentExpiresAt <= now)
}
