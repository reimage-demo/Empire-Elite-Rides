import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateRidePrice, isTimeInWindow } from '../convex/lib/pricingCore.mjs'
import { mergePricingSnapshot } from '../convex/lib/pricingConfig.mjs'

const config = {
  baseServiceFeeCents: 1000, passengerPerMileCents: 100, passengerPerMinuteCents: 10,
  positioningPerMileCents: 50, positioningPerMinuteCents: 5, returnPerMileCents: 50, returnPerMinuteCents: 5,
  positioningMileageChargeBps: 10000, positioningTimeChargeBps: 10000, returnMileageChargeBps: 10000, returnTimeChargeBps: 10000,
  includedPositioningRadiusMiles: 0, maximumPositioningChargeCents: 100000, includedMiles: 0, includedMinutes: 0,
  minimumFareCents: 1000, airportMinimumFareCents: 1000, eventMinimumFareCents: 1000,
  minimumHourlyBookingMinutes: 180, hourlyRateCents: 10000, waitTimeGraceMinutes: 10, waitTimePerMinuteCents: 100,
  maximumAutomaticWaitMinutes: 120, additionalStopFeeCents: 500, includedStops: 0, airportFeeCents: 1000, meetAndGreetFeeCents: 500,
  limitedAvailabilityAdjustmentCents: 700, taxPercentageBps: 0, gratuityPercentageBps: 0,
  fuelCostPerMileCents: 0, vehicleWearPerMileCents: 0, chauffeurLaborPerMinuteCents: 0, cleaningCostCents: 0, targetMarginBps: 0,
  rushHourRules: [{activeDays:[1],startTime:'06:30',endTime:'09:30',percentageBps:1000,flatCents:0,appliesToPickup:true}],
  afterHoursRules: [{startTime:'22:00',endTime:'05:00',percentageBps:1000,flatCents:0,manualApproval:false}]
}
const route = {
  passengerDistanceMeters: 16093.44, positioningDistanceMeters: 8046.72, returnDistanceMeters: 8046.72,
  passengerTrafficDurationSeconds: 1800, positioningTrafficDurationSeconds: 600, returnTrafficDurationSeconds: 600, tollEstimateCents: 0
}
const baseInput = { route, pickupTime:'12:00',pickupWeekday:2,scheduledPickupAt:10*3600000,now:0,requestedWaitMinutes:0,additionalStopCount:0,availability:{status:'available'},demand:{applies:false} }

test('older saved pricing snapshots inherit new long-distance defaults', () => {
  const merged = mergePricingSnapshot({ competitiveLongDistanceEnabled: true, competitiveLongDistancePerMileCents: 95 }, { baseServiceFeeCents: 7500 })
  assert.equal(merged.competitiveLongDistanceEnabled, true)
  assert.equal(merged.competitiveLongDistancePerMileCents, 95)
  assert.equal(merged.baseServiceFeeCents, 7500)
})

test('zero-value admin pricing fields are preserved exactly', () => {
  const merged = mergePricingSnapshot({ baseServiceFeeCents: 6000 }, { baseServiceFeeCents: 0 })
  assert.equal(merged.baseServiceFeeCents, 0)
})

test('money remains integer cents and includes positioning and return travel', () => {
  const result = calculateRidePrice(baseInput, config)
  assert.equal(Number.isInteger(result.finalPriceCents), true)
  assert.equal(result.positioningMiles, 5)
  assert.equal(result.returnMiles, 5)
  assert.ok(result.internalBreakdown.some(line => line.key === 'positioning_and_return'))
})
test('airport service adds only its flat fee without a separate minimum', () => {
  const fixedConfig = {...config,localMarketPricingEnabled:true,localMarketPerMileCents:100,localMarketPerMinuteCents:10,localMarketAllowBelowCostFloor:true,airportFeeCents:1000,airportMinimumFareCents:5000,meetAndGreetFeeCents:9000}
  const base = calculateRidePrice(baseInput, fixedConfig)
  const result = calculateRidePrice({...baseInput,airportOptions:{enabled:true,meetAndGreet:true,parkingEstimateCents:5000}}, fixedConfig)
  assert.equal(result.finalPriceCents, base.finalPriceCents + 1000)
  assert.equal(result.customerBreakdown.some(line => /minimum|meet-and-greet|parking/i.test(line.label)), false)
})
test('the largest eligible promotion is applied without stacking', () => {
  const websitePromotion = {name:'Website 10%',percentageBps:1000,flatDiscountCents:0,maximumDiscountCents:0,minimumBookingCents:0,allowBelowMinimum:true}
  const result = calculateRidePrice({...baseInput,promotions:[
    websitePromotion,
    {name:'Repeat customer 5%',percentageBps:500,flatDiscountCents:0,maximumDiscountCents:0,minimumBookingCents:0,allowBelowMinimum:true}
  ]}, config)
  const websiteOnly = calculateRidePrice({...baseInput,promotion:websitePromotion}, config)
  assert.equal(result.appliedPromotion.name, 'Website 10%')
  assert.equal(result.discountCents, websiteOnly.discountCents)
  assert.equal(result.customerBreakdown.filter(line => line.amountCents < 0).length, 1)
})
test('an approved promotion can reduce route pricing but not the profitability floor', () => {
  const result = calculateRidePrice({...baseInput,promotion:{name:'Owner offer',percentageBps:1000,flatDiscountCents:0,maximumDiscountCents:0,minimumBookingCents:0,allowBelowMinimum:true}}, {...config,minimumFareCents:5000})
  assert.ok(result.finalPriceCents >= result.profitabilityFloorCents)
})
test('profitability floor remains private and enforced', () => {
  const result = calculateRidePrice(baseInput, {...config,fuelCostPerMileCents:500,targetMarginBps:2000})
  assert.ok(result.finalPriceCents >= result.profitabilityFloorCents)
  assert.equal(result.customerBreakdown.some(line => /profit|fuel|margin/i.test(line.label)), false)
})
test('rush hour applies once', () => {
  const result = calculateRidePrice({...baseInput,pickupTime:'07:00',pickupWeekday:1}, config)
  assert.equal(result.internalBreakdown.filter(line => line.key === 'rush_hour').length, 1)
})
test('short-notice pricing is completely ignored', () => {
  const result = calculateRidePrice({...baseInput,scheduledPickupAt:30*60000}, {...config,shortNoticeRules:[{maximumHours:24,percentageBps:9900,manualApproval:true}]})
  assert.equal(result.internalBreakdown.some(line => line.key === 'short_notice'), false)
  assert.equal(result.customerBreakdown.some(line => /short-notice/i.test(line.label)), false)
  assert.equal(result.manualReview, false)
})
test('local rides never add a generic chauffeur base fee', () => {
  const low = calculateRidePrice(baseInput, {...config,baseServiceFeeCents:0})
  const high = calculateRidePrice(baseInput, {...config,baseServiceFeeCents:9000})
  assert.equal(high.finalPriceCents, low.finalPriceCents)
  assert.equal(high.customerBreakdown.some(line => /chauffeur service/i.test(line.label)), false)
})
test('owner Uber benchmark prices the 6.3 mile, 12 minute reference ride at $37.20', () => {
  const benchmarkRoute = {
    ...route,
    passengerDistanceMeters: 6.3 * 1609.344,
    passengerTrafficDurationSeconds: 12 * 60
  }
  const result = calculateRidePrice({...baseInput,route:benchmarkRoute}, {
    ...config,
    minimumFareCents: 12500,
    localMarketPricingEnabled: true,
    localMarketPerMileCents: 400,
    localMarketPerMinuteCents: 100,
    localMarketAllowBelowCostFloor: true,
    fuelCostPerMileCents: 500,
    targetMarginBps: 5000
  })
  assert.equal(result.finalPriceCents, 3720)
  assert.equal(result.customerBreakdown.some(line => /minimum|positioning|chauffeur/i.test(line.label)), false)
})
test('local booking price can increase only for airport service and selected waiting time', () => {
  const fixedConfig = {
    ...config,
    localMarketPricingEnabled: true,
    localMarketPerMileCents: 400,
    localMarketPerMinuteCents: 100,
    localMarketAllowBelowCostFloor: true,
    waitTimeGraceMinutes: 0,
    waitTimePerMinuteCents: 125,
    airportFeeCents: 1000,
    additionalStopFeeCents: 9999,
    limitedAvailabilityAdjustmentCents: 9999
  }
  const noisyInput = {...baseInput,pickupTime:'07:00',pickupWeekday:1,requestedWaitMinutes:15,additionalStopCount:2,airportOptions:{enabled:true,meetAndGreet:true,parkingEstimateCents:9999},holidayRule:{flatCents:9999,percentageBps:9999},specialEventRule:{flatCents:9999,percentageBps:9999},demand:{applies:true,flatCents:9999,percentageBps:9999,maximumAdjustmentCents:9999},availability:{status:'limited_availability'}}
  const baseline = calculateRidePrice(baseInput, fixedConfig)
  const result = calculateRidePrice(noisyInput, fixedConfig)
  assert.equal(result.finalPriceCents, baseline.finalPriceCents + 1000 + 15 * 125)
  assert.deepEqual(result.customerBreakdown.map(line => line.label), ['Route and travel','Requested waiting time','Airport service','Total'])
})
test('holiday, demand, and limited availability create customer-safe lines', () => {
  const result = calculateRidePrice({...baseInput,holidayRule:{flatCents:100,percentageBps:0},demand:{applies:true,flatCents:100,percentageBps:0,maximumAdjustmentCents:1000},availability:{status:'limited_availability'}}, config)
  assert.ok(result.customerBreakdown.some(line => line.label === 'Holiday service adjustment'))
  assert.ok(result.customerBreakdown.some(line => line.label === 'Scheduling-demand adjustment'))
  assert.ok(result.customerBreakdown.some(line => line.label === 'Limited-availability adjustment'))
})
test('overnight windows crossing midnight are supported', () => {
  assert.equal(isTimeInWindow('23:30','22:00','05:00'), true)
  assert.equal(isTimeInWindow('04:30','22:00','05:00'), true)
  assert.equal(isTimeInWindow('12:00','22:00','05:00'), false)
})

test('competitive long-distance promotion prices the reference airport trip between Comfort and XL', () => {
  const promotionalConfig = {
    ...config,
    airportFeeCents: 2500,
    competitiveLongDistanceEnabled: true,
    competitiveLongDistanceThresholdMiles: 25,
    competitiveLongDistanceBaseFeeCents: 2000,
    competitiveLongDistanceFirstTierPerMileCents: 250,
    competitiveLongDistancePerMileCents: 95,
    competitiveLongDistancePerMinuteCents: 25,
    competitiveLongDistanceMaximumPositioningChargeCents: 0,
    competitiveLongDistanceAllowBelowCostFloor: true,
    competitiveLongDistanceRequiresReview: true,
    afterHoursRules: [{startTime:'00:00',endTime:'05:00',percentageBps:1500,flatCents:0,manualApproval:true}]
  }
  const referenceRoute = {
    passengerDistanceMeters: 130 * 1609.344,
    passengerTrafficDurationSeconds: 132 * 60,
    positioningDistanceMeters: 120 * 1609.344,
    positioningTrafficDurationSeconds: 120 * 60,
    returnDistanceMeters: 10 * 1609.344,
    returnTrafficDurationSeconds: 15 * 60,
    tollEstimateCents: 0
  }
  const result = calculateRidePrice({
    ...baseInput,
    route: referenceRoute,
    pickupTime: '04:00',
    airportOptions: {enabled:true, direction:'dropoff', parkingEstimateCents:0},
    promotion: {name:'Do not stack',percentageBps:5000,flatDiscountCents:0,maximumDiscountCents:0,minimumBookingCents:0,allowBelowMinimum:true}
  }, promotionalConfig)
  assert.equal(result.finalPriceCents, 27254)
  assert.ok(result.finalPriceCents >= 21399 && result.finalPriceCents <= 27800)
  assert.equal(result.manualReview, true)
  assert.equal(result.appliedPromotion, null)
  assert.equal(result.internalBreakdown.find(line => line.key === 'positioning_and_return'), undefined)
})

test('competitive long-distance promotion does not reduce local-trip pricing', () => {
  const result = calculateRidePrice(baseInput, {...config,competitiveLongDistanceEnabled:true,competitiveLongDistanceThresholdMiles:25})
  const standard = calculateRidePrice(baseInput, config)
  assert.equal(result.finalPriceCents, standard.finalPriceCents)
})

test('round-trip savings applies fifteen percent even with long-distance pricing', () => {
  const result = calculateRidePrice({
    ...baseInput,
    route: { ...baseInput.route, passengerDistanceMeters: 50 * 1609.344 },
    roundTripPromotion: { name: 'Round-trip savings', discountLabel: 'Round-trip savings (15% off)', percentageBps: 1500, flatDiscountCents: 0, maximumDiscountCents: 0, minimumBookingCents: 0, allowBelowMinimum: true }
  }, { ...config, competitiveLongDistanceEnabled: true, competitiveLongDistanceThresholdMiles: 25, competitiveLongDistanceBaseFeeCents: 2000, competitiveLongDistanceFirstTierPerMileCents: 250, competitiveLongDistancePerMileCents: 95, competitiveLongDistancePerMinuteCents: 25, competitiveLongDistanceMaximumPositioningChargeCents: 0, competitiveLongDistanceAllowBelowCostFloor: true, competitiveLongDistanceRequiresReview: true })
  assert.equal(result.appliedPromotion.name, 'Round-trip savings')
  assert.equal(result.customerBreakdown.some(line => line.label === 'Round-trip savings (15% off)' && line.amountCents < 0), true)
})
