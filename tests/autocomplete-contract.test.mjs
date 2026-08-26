import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const client = await readFile(new URL('../pricing-client.js', import.meta.url), 'utf8')
const quotes = await readFile(new URL('../convex/quotes.ts', import.meta.url), 'utf8')
const quickPrice = await readFile(new URL('../quick-price.js', import.meta.url), 'utf8')
const booking = await readFile(new URL('../booking.js', import.meta.url), 'utf8')
const homepageMarkup = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const bookingMarkup = await readFile(new URL('../booking.html', import.meta.url), 'utf8')

test('address suggestions start with the first typed character', () => {
  assert.match(client, /if \(!query\.length\) return clearList\(\)/)
  assert.doesNotMatch(client, /setTimeout\([\s\S]*searchAddresses/)
  assert.match(client, /new ConvexClient/)
  assert.match(client, /activeQuery\.startsWith\(query\.toLowerCase\(\)\)/)
  assert.match(quotes, /if \(!text\.trim\(\)\) return \[\]/)
})

test('selecting or leaving an address field cancels stale suggestion requests', () => {
  assert.match(client, /function cancelPendingRequests\(\)/)
  assert.match(client, /function setSelection\(next\) \{[\s\S]*?cancelPendingRequests\(\)/)
  assert.match(client, /input\.addEventListener\('blur',[\s\S]*?cancelPendingRequests\(\)/)
})

test('applying dates closes calendars without reactivating their trigger fields', () => {
  assert.doesNotMatch(quickPrice, /closeCalendar\(\);\s*calendarTrigger\.focus\(\)/)
  assert.doesNotMatch(booking, /closeBookingCalendar\(\);\s*bookingCalendarTrigger\.focus\(\)/)
})

test('customers can explicitly request current-location pickup autofill', () => {
  assert.match(homepageMarkup, /data-use-current-location/)
  assert.match(bookingMarkup, /data-use-current-location/)
  assert.match(client, /navigator\.geolocation\.getCurrentPosition/)
  assert.match(client, /button\.addEventListener\('click', async/)
  assert.match(client, /quotes:locateAddress/)
  assert.match(quotes, /api\.geoapify\.com\/v1\/geocode\/reverse/)
  assert.match(quotes, /cacheAddressSelections/)
  assert.match(quotes, /return \{ placeId: result\.placeId, address: result\.formattedAddress \}/)
})
