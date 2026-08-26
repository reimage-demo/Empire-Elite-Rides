export const MAX_DAILY_RESERVATIONS = 3
export const MINIMUM_PICKUP_SPACING_MS = 2 * 60 * 60 * 1000

export function capacityIssue(existingPickupTimes, candidatePickupAt) {
  if (existingPickupTimes.length >= MAX_DAILY_RESERVATIONS) return 'day_full'
  if (existingPickupTimes.some(pickupAt => Math.abs(candidatePickupAt - pickupAt) < MINIMUM_PICKUP_SPACING_MS)) return 'pickup_spacing'
  return null
}
