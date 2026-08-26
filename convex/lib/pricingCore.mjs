const METERS_PER_MILE = 1609.344
const secondsToMinutes = value => Math.ceil(value / 60)
const metersToBillableMiles = value => Math.ceil((value / METERS_PER_MILE) * 10) / 10
const money = value => Math.max(0, Math.round(value))
const bpsAmount = (cents, bps) => money(cents * Number(bps || 0) / 10000)
const timeMinutes = value => {
  if (value === '24:00') return 1440
  const [hours, minutes] = String(value).split(':').map(Number)
  return hours * 60 + minutes
}

export function isTimeInWindow(time, start, end) {
  const value = timeMinutes(time), from = timeMinutes(start), until = timeMinutes(end)
  return from <= until ? value >= from && value < until : value >= from || value < until
}

export function calculateRidePrice(input, config) {
  const passengerMiles = metersToBillableMiles(input.route.passengerDistanceMeters)
  const positioningMiles = metersToBillableMiles(input.route.positioningDistanceMeters)
  const returnMiles = metersToBillableMiles(input.route.returnDistanceMeters)
  const passengerMinutes = secondsToMinutes(input.route.passengerTrafficDurationSeconds)
  const positioningMinutes = secondsToMinutes(input.route.positioningTrafficDurationSeconds)
  const returnMinutes = secondsToMinutes(input.route.returnTrafficDurationSeconds)
  const totalMiles = passengerMiles + positioningMiles + returnMiles
  const totalMinutes = passengerMinutes + positioningMinutes + returnMinutes + Number(input.requestedWaitMinutes || 0)
  const internal = []
  const customer = []
  let subtotal = 0
  let manualReview = Boolean(input.manualReview)
  const competitiveLongDistance = Boolean(config.competitiveLongDistanceEnabled) &&
    passengerMiles >= Number(config.competitiveLongDistanceThresholdMiles || Number.MAX_SAFE_INTEGER)
  const localMarketPricing = !competitiveLongDistance && Boolean(config.localMarketPricingEnabled) &&
    !input.hourlyDetails?.hours && !input.eventOptions?.enabled

  const add = (internalKey, customerLabel, cents, customerVisible = true) => {
    const amountCents = money(cents)
    if (!amountCents) return
    internal.push({ key: internalKey, amountCents })
    if (customerVisible) customer.push({ label: customerLabel, amountCents })
    subtotal += amountCents
  }

  if (competitiveLongDistance) add('long_distance_base', 'Long-distance service base', config.competitiveLongDistanceBaseFeeCents)
  const billablePassengerMiles = Math.max(0, passengerMiles - Number(config.includedMiles || 0))
  const passengerDistance = localMarketPricing
    ? money(billablePassengerMiles * config.localMarketPerMileCents)
    : competitiveLongDistance
    ? money(
      Math.min(billablePassengerMiles, Number(config.competitiveLongDistanceThresholdMiles)) * config.competitiveLongDistanceFirstTierPerMileCents +
      Math.max(0, billablePassengerMiles - Number(config.competitiveLongDistanceThresholdMiles)) * config.competitiveLongDistancePerMileCents
    )
    : money(billablePassengerMiles * config.passengerPerMileCents)
  const passengerMinuteRate = localMarketPricing ? config.localMarketPerMinuteCents : competitiveLongDistance ? config.competitiveLongDistancePerMinuteCents : config.passengerPerMinuteCents
  const passengerTime = money(Math.max(0, passengerMinutes - Number(config.includedMinutes || 0)) * passengerMinuteRate)
  add('passenger_route', 'Route and travel', passengerDistance + passengerTime)

  const includedPositioning = Number(config.includedPositioningRadiusMiles || 0)
  const positioningDistance = bpsAmount(money(Math.max(0, positioningMiles - includedPositioning) * config.positioningPerMileCents), config.positioningMileageChargeBps)
  const positioningTime = bpsAmount(money(positioningMinutes * config.positioningPerMinuteCents), config.positioningTimeChargeBps)
  const returnDistance = bpsAmount(money(returnMiles * config.returnPerMileCents), config.returnMileageChargeBps)
  const returnTime = bpsAmount(money(returnMinutes * config.returnPerMinuteCents), config.returnTimeChargeBps)
  const configuredPositioningMaximum = competitiveLongDistance
    ? Number(config.competitiveLongDistanceMaximumPositioningChargeCents)
    : Number(config.maximumPositioningChargeCents)
  const positioningMaximum = Number.isFinite(configuredPositioningMaximum) ? configuredPositioningMaximum : Number.MAX_SAFE_INTEGER
  const positioningCharge = localMarketPricing ? 0 : Math.min(positioningDistance + positioningTime + returnDistance + returnTime, positioningMaximum)
  add('positioning_and_return', 'Vehicle positioning and travel', positioningCharge)

  // Local-market quotes are fixed route prices. Booking options may add only
  // the explicitly selected airport service and requested waiting time.
  if (!localMarketPricing) {
    const preAdjustmentSubtotal = subtotal
    const pickupWeekday = Number(input.pickupWeekday)
    const rushRule = (config.rushHourRules || []).find(rule =>
      rule.activeDays.includes(pickupWeekday) && rule.appliesToPickup && isTimeInWindow(input.pickupTime, rule.startTime, rule.endTime)
    )
    if (rushRule) add('rush_hour', 'Peak travel-time adjustment', rushRule.flatCents + bpsAmount(preAdjustmentSubtotal, rushRule.percentageBps))

    const afterHoursRule = (config.afterHoursRules || [])
      .filter(rule => isTimeInWindow(input.pickupTime, rule.startTime, rule.endTime))
      .sort((a, b) => (b.percentageBps || 0) - (a.percentageBps || 0) || (b.flatCents || 0) - (a.flatCents || 0))[0]
    if (afterHoursRule) {
      if (afterHoursRule.manualApproval) manualReview = true
      add('after_hours', 'After-hours service adjustment', afterHoursRule.flatCents + bpsAmount(preAdjustmentSubtotal, afterHoursRule.percentageBps))
    }

    if (input.holidayRule) {
      if (input.holidayRule.manualApproval) manualReview = true
      add('holiday', 'Holiday service adjustment', input.holidayRule.flatCents + bpsAmount(preAdjustmentSubtotal, input.holidayRule.percentageBps))
    }
    if (input.specialEventRule) {
      if (input.specialEventRule.manualApproval) manualReview = true
      add('special_event', 'Special-event adjustment', input.specialEventRule.flatCents + bpsAmount(preAdjustmentSubtotal, input.specialEventRule.percentageBps))
    }
    if (input.demand?.applies) add('demand', 'Scheduling-demand adjustment', Math.min(input.demand.flatCents + bpsAmount(preAdjustmentSubtotal, input.demand.percentageBps), input.demand.maximumAdjustmentCents))
    if (input.availability?.status === 'limited_availability') add('limited_availability', 'Limited-availability adjustment', config.limitedAvailabilityAdjustmentCents)
  }
  if (input.availability?.status === 'confirmation_required') manualReview = true

  const stopCount = Math.max(0, Number(input.additionalStopCount || 0) - Number(config.includedStops || 0))
  if (!localMarketPricing) add('additional_stops', 'Additional stops', stopCount * config.additionalStopFeeCents)
  const billableWait = Math.max(0, Number(input.requestedWaitMinutes || 0) - Number(config.waitTimeGraceMinutes || 0))
  add('requested_waiting', 'Requested waiting time', billableWait * config.waitTimePerMinuteCents)
  if (Number(input.requestedWaitMinutes || 0) > Number(config.maximumAutomaticWaitMinutes || 0)) manualReview = true
  if (input.airportOptions?.enabled) {
    add('airport', 'Airport service', config.airportFeeCents)
  }
  if (input.hourlyDetails?.hours) {
    const billedMinutes = Math.max(config.minimumHourlyBookingMinutes, Math.ceil(input.hourlyDetails.hours * 60))
    add('hourly_service', 'Hourly chauffeur service', money(billedMinutes / 60 * config.hourlyRateCents))
  }
  if (!localMarketPricing) add('tolls', 'Estimated tolls', input.route.tollEstimateCents || 0)

  const calculatedSubtotalCents = subtotal
  // The long-distance rate does not stack with general campaigns, but the
  // dedicated round-trip savings remains eligible for a booked return ride.
  const generalPromotions = competitiveLongDistance ? [] : [...(input.promotions || []), ...(input.promotion ? [input.promotion] : [])]
  const candidates = [...generalPromotions, ...(input.roundTripPromotion ? [input.roundTripPromotion] : [])]
  const evaluatedPromotions = candidates.map(promotion => {
    const requested = Number(promotion.flatDiscountCents || 0) + bpsAmount(subtotal, promotion.percentageBps || 0)
    const capped = Math.min(requested, Number(promotion.maximumDiscountCents || requested))
    return { promotion, discountCents: subtotal >= Number(promotion.minimumBookingCents || 0) ? Math.min(capped, subtotal) : 0 }
  })
  const selected = evaluatedPromotions.sort((a, b) => b.discountCents - a.discountCents)[0]
  const appliedPromotion = selected?.discountCents ? selected.promotion : null
  const discountCents = selected?.discountCents || 0
  if (discountCents) customer.push({ label: appliedPromotion.discountLabel || 'Discount', amountCents: -discountCents })
  subtotal -= discountCents

  const serviceMinimum = input.hourlyDetails?.hours
    ? money(config.minimumHourlyBookingMinutes / 60 * config.hourlyRateCents)
    : input.eventOptions?.enabled ? config.eventMinimumFareCents : 0
  const fuelCost = money(totalMiles * config.fuelCostPerMileCents)
  const wearCost = money(totalMiles * config.vehicleWearPerMileCents)
  const laborCost = money(totalMinutes * config.chauffeurLaborPerMinuteCents)
  const directCost = fuelCost + wearCost + laborCost + Number(config.cleaningCostCents || 0) + Number(input.route.tollEstimateCents || 0)
  const profitabilityFloorCents = money(directCost / Math.max(0.01, 1 - Number(config.targetMarginBps || 0) / 10000))
  const appliesCostFloor = !(competitiveLongDistance && config.competitiveLongDistanceAllowBelowCostFloor) &&
    !(localMarketPricing && config.localMarketAllowBelowCostFloor)
  if (competitiveLongDistance && (config.competitiveLongDistanceRequiresReview || (!appliesCostFloor && subtotal < profitabilityFloorCents))) manualReview = true
  const protectedSubtotal = Math.max(subtotal, appliedPromotion?.allowBelowMinimum ? 0 : serviceMinimum, appliesCostFloor ? profitabilityFloorCents : 0)
  if (protectedSubtotal > subtotal) customer.push({ label: 'Minimum ride price adjustment', amountCents: protectedSubtotal - subtotal })

  const taxCents = bpsAmount(protectedSubtotal, config.taxPercentageBps)
  const gratuityCents = bpsAmount(protectedSubtotal, config.gratuityPercentageBps)
  if (taxCents) customer.push({ label: 'Tax', amountCents: taxCents })
  if (gratuityCents) customer.push({ label: 'Gratuity', amountCents: gratuityCents })
  const finalPriceCents = protectedSubtotal + taxCents + gratuityCents
  internal.push(
    { key: 'calculated_subtotal', amountCents: calculatedSubtotalCents },
    { key: 'minimum_fare', amountCents: serviceMinimum },
    { key: 'direct_cost', amountCents: directCost },
    { key: 'profitability_floor', amountCents: profitabilityFloorCents },
    ...(competitiveLongDistance ? [{ key: 'competitive_long_distance_promotion', amountCents: Math.max(0, profitabilityFloorCents - protectedSubtotal) }] : [])
  )

  return {
    passengerMiles, passengerMinutes, positioningMiles, positioningMinutes, returnMiles, returnMinutes,
    subtotalCents: protectedSubtotal, discountCents, taxCents, gratuityCents,
    tollEstimateCents: Number(input.route.tollEstimateCents || 0), finalPriceCents, appliedPromotion,
    manualReview,
    customerBreakdown: [...customer, { label: 'Total', amountCents: finalPriceCents }],
    internalBreakdown: internal,
    profitabilityFloorCents
  }
}
