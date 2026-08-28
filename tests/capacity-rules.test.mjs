import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { capacityIssue, MAX_DAILY_RESERVATIONS, MINIMUM_PICKUP_SPACING_MS } from '../convex/lib/capacityCore.mjs'

const hour = 60 * 60 * 1000
const quotes = await readFile(new URL('../convex/quotes.ts', import.meta.url), 'utf8')
const reservations = await readFile(new URL('../convex/reservations.ts', import.meta.url), 'utf8')
const bookings = await readFile(new URL('../convex/bookings.ts', import.meta.url), 'utf8')
const quickPrice = await readFile(new URL('../quick-price.js', import.meta.url), 'utf8')
const booking = await readFile(new URL('../booking.js', import.meta.url), 'utf8')
const admin = await readFile(new URL('../admin-portal/src/App.jsx', import.meta.url), 'utf8')
const pricingClient = await readFile(new URL('../pricing-client.js', import.meta.url), 'utf8')

test('a date accepts no more than three active reservations', () => {
  assert.equal(MAX_DAILY_RESERVATIONS, 3)
  assert.equal(capacityIssue([13 * hour, 15 * hour], 17 * hour), null)
  assert.equal(capacityIssue([9 * hour, 13 * hour, 17 * hour], 21 * hour), 'day_full')
})

test('pickup times must be at least two hours apart', () => {
  assert.equal(MINIMUM_PICKUP_SPACING_MS, 2 * hour)
  assert.equal(capacityIssue([13 * hour], 13 * hour), 'pickup_spacing')
  assert.equal(capacityIssue([13 * hour], 14 * hour + 45 * 60 * 1000), 'pickup_spacing')
  assert.equal(capacityIssue([13 * hour], 14 * hour + 59 * 60 * 1000), 'pickup_spacing')
  assert.equal(capacityIssue([13 * hour], 15 * hour), null)
})

test('capacity is enforced for quotes, website reservations, and admin bookings', () => {
  assert.match(quotes, /capacityIssue\(/)
  assert.match(reservations, /capacityIssue\(/)
  assert.match(reservations, /DAY_FULL/)
  assert.match(bookings, /capacityIssue\(/)
  assert.match(bookings, /DAY_FULL/)
  assert.match(admin, /MAX_DAILY_RESERVATIONS = 3/)
  assert.match(admin, /MINIMUM_PICKUP_SPACING_MINUTES = 120/)
})

test('availability and schedule conflicts are scoped to the selected vehicle', () => {
  assert.match(quotes, /row\.vehicleId === args\.vehicleId/)
  assert.match(quotes, /fleetAvailability\.find/)
  assert.match(reservations, /row\.vehicleId === quote\.vehicleId/)
  assert.match(bookings, /row\.vehicleId === vehicle\._id/)
  assert.match(booking, /\{ serviceDate, vehicleKey \}/)
  assert.match(admin, /vehicleKey\(row\) === form\.vehicleKey/)
})

test('customer and admin pickup selectors retain 15-minute intervals and remove blocked options', () => {
  assert.match(pricingClient, /for \(const minute of \[0, 15, 30, 45\]\)/)
  assert.match(pricingClient, /if \(unavailable\.has\(optionValue\)\) continue/)
  assert.match(pricingClient, /setUnavailable/)
  assert.match(quickPrice, /bookings:availabilityForDate/)
  assert.match(booking, /bookings:availabilityForDate/)
  assert.match(bookings, /minute \+= 15/)
  assert.match(bookings, /\(00\|15\|30\|45\)/)
  assert.match(admin, /length: 96/)
  assert.match(admin, /index \* 15/)
})

test('public capacity messages do not disclose the internal reservation limit', () => {
  for (const source of [quickPrice, booking]) {
    assert.match(source, /fully booked/)
    assert.doesNotMatch(source, /three active reservations|maximum of three|daily capacity/i)
  }
})
