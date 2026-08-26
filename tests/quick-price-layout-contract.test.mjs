import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const homepage = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const booking = readFileSync(new URL('../booking.html', import.meta.url), 'utf8')
const quickPrice = readFileSync(new URL('../quick-price.js', import.meta.url), 'utf8')
const pricingClient = readFileSync(new URL('../pricing-client.js', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

test('pickup and return dates align beside their corresponding times', () => {
  for (const markup of [homepage, booking]) {
    const schedule = markup.match(/<div class="(?:quick-date-range date-range-control|date-range-control booking-date-range)"[\s\S]*?<div id="(?:quick|booking)-range-calendar"/)?.[0]
    assert.ok(schedule)
    assert.ok(schedule.indexOf('Pickup date') < schedule.indexOf('Pickup time'))
    assert.ok(schedule.indexOf('Return date') < schedule.indexOf('Return time'))
  }
})

test('round-trip savings appears immediately before the Get Price button', () => {
  assert.match(homepage, /<div class="quick-submit-actions">\s*<p class="quick-roundtrip-note">[\s\S]*?<button class="gold-button" type="submit">Get Price<\/button>/)
})

test('homepage return time carries into the full booking form', () => {
  assert.match(quickPrice, /returnTime=\$\{encodeURIComponent\(form\.elements\.returnTime\.value\)\}/)
})

test('schedule uses branded dropdowns with 15-minute choices', () => {
  for (const markup of [homepage, booking]) {
    assert.doesNotMatch(markup, /type="time"/)
    assert.match(markup, /<select[^>]*class="time-select"[^>]*data-time-picker/)
  }
  assert.match(pricingClient, /\[0, 15, 30, 45\]/)
})

test('home-screen shortcut appears above the quick-price inputs', () => {
  assert.ok(homepage.indexOf('class="quick-install-action"') < homepage.indexOf('<form id="quick-price-form"'))
})

test('current-location shortcut is centered below the home-screen shortcut', () => {
  const installPosition = homepage.indexOf('class="quick-install-action"')
  const locationPosition = homepage.indexOf('class="use-location-button quick-location-action"')
  const formPosition = homepage.indexOf('<form id="quick-price-form"')
  assert.ok(installPosition < locationPosition && locationPosition < formPosition)
  assert.doesNotMatch(homepage.match(/<div class="address-field">[\s\S]*?<\/div>/)?.[0] || '', /data-use-current-location/)
})

test('mobile schedule controls fill the card and location actions have breathing room', () => {
  const mobile = styles.match(/@media \(max-width: 600px\) \{[\s\S]*?@media \(prefers-reduced-motion/)?.[0] || ''
  assert.match(mobile, /\.date-range-control \{ grid-template-columns: minmax\(0, 1fr\); gap: 15px; width: 100%; \}/)
  assert.match(mobile, /\.date-range-control \.date-range-display, \.date-range-control select\.time-select \{ width: 100%; \}/)
  assert.match(mobile, /\.quick-install-action \{ margin-bottom: 28px; \}/)
  assert.match(mobile, /\.quick-location-row \{ margin-bottom: 30px; \}/)
})
