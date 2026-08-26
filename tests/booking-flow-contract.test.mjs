import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const html = await readFile(new URL('../booking.html', import.meta.url), 'utf8')
const home = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const script = await readFile(new URL('../booking.js', import.meta.url), 'utf8')
const siteScript = await readFile(new URL('../script.js', import.meta.url), 'utf8')
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8')
const manifest = await readFile(new URL('../site.webmanifest', import.meta.url), 'utf8')
const pricingDefaults = await readFile(new URL('../convex/lib/defaultPricing.ts', import.meta.url), 'utf8')
const quotes = await readFile(new URL('../convex/quotes.ts', import.meta.url), 'utf8')
const admin = await readFile(new URL('../admin-portal/src/App.jsx', import.meta.url), 'utf8')
const customerConfig = await readFile(new URL('../config.js', import.meta.url), 'utf8')
const adminEntry = await readFile(new URL('../admin-portal/src/main.jsx', import.meta.url), 'utf8')
const adminDeployment = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')

test('booking presents exactly one of five centered steps at a time', () => {
  assert.equal((html.match(/data-booking-step="\d"/g) || []).length, 5)
  assert.equal((html.match(/data-booking-step="[1-4]"[^>]*hidden/g) || []).length, 4)
  assert.match(html, /Step 1 of 5/)
  assert.match(script, /bookingSteps\.forEach\(\(step, stepIndex\) => \{ step\.hidden = stepIndex !== currentBookingStep; \}\)/)
})

test('booking validates each visible step and prices automatically on review', () => {
  assert.match(script, /function validateBookingStep\(index\)/)
  assert.match(script, /currentBookingStep === bookingSteps\.length - 1 && !currentQuote\) void calculateQuote\(\)/)
  assert.match(html, /data-step-back/)
  assert.match(html, /data-step-next/)
})

test('mobile booking keeps navigation visible in a single app-style screen', () => {
  assert.match(html, /<body class="booking-page">/)
  assert.match(styles, /\.booking-page \.booking-intro, \.booking-page \.site-footer \{ display: none; \}/)
  assert.match(styles, /\.booking-page \.booking-step-actions[\s\S]*position: fixed/)
  assert.doesNotMatch(home, /Get Price <span>→<\/span>/)
})

test('optional ride details can be skipped and notes live on final review', () => {
  assert.match(html, /data-step-skip>Skip optional details/)
  assert.doesNotMatch(html, /<select name="eventType"/)
  assert.match(html, /name="eventType" type="hidden" value="Private ride"/)
  assert.match(html, /class="final-notes"[\s\S]*name="notes"/)
})

test('homepage estimates skip already-completed route and schedule steps', () => {
  assert.match(script, /returnPickup\.setSelection\(estimate\.dropoff\)/)
  assert.match(script, /returnDropoff\.setSelection\(estimate\.pickup\)/)
  assert.match(script, /showBookingStep\(scheduleComplete \? 2 : 1/)
  assert.match(html, /data-estimate-transfer-note/)
})

test('direct booking keeps a centered location shortcut and aligned address fields', () => {
  const routeStep = html.match(/data-booking-step="0"[\s\S]*?data-booking-step="1"/)?.[0] || ''
  assert.match(routeStep, /booking-location-row[\s\S]*data-use-current-location/)
  assert.ok(routeStep.indexOf('booking-location-row') < routeStep.indexOf('id="booking-pickup"'))
  assert.doesNotMatch(routeStep, /address-field-heading/)
})

test('price-affecting booking choices explain that the price can change', () => {
  assert.match(html, /Route distance, service type, and added stops can change your price/)
  assert.match(html, /Your selected date and time will not add a pricing adjustment/)
  assert.match(html, /estimate stays the same unless you select the \$10 airport service or add waiting time/)
  assert.match(html, /Airport service adds one flat \$10 fee/)
  assert.doesNotMatch(html, /meet-and-greet service|estimated parking/i)
})

test('airport service requires a branded airline choice and flight number', () => {
  assert.match(html, /name="airline"/)
  assert.match(html, /American Airlines/)
  assert.match(html, /Southwest Airlines/)
  assert.match(html, /Other U\.S\. airline/)
  assert.match(html, /name="flightNumber"/)
  assert.match(script, /airline: form\.elements\.airline\.value/)
  assert.doesNotMatch(script, /meetAndGreet|parkingEstimateCents/)
  assert.match(quotes, /supportedAirlines/)
  assert.match(quotes, /INVALID_AIRPORT_DETAILS/)
})

test('admin and customer pricing use the same production deployment', () => {
  const customerUrl = customerConfig.match(/https:\/\/[^\s"']+\.convex\.cloud/)?.[0]
  assert.ok(customerUrl)
  const exactUrl = new RegExp(customerUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  assert.match(adminEntry, exactUrl)
  assert.match(adminDeployment, exactUrl)
})

test('new deployments start with no chauffeur base-service fee', () => {
  assert.match(pricingDefaults, /baseServiceFeeCents: 0/)
  assert.match(pricingDefaults, /minimumFareCents: 0/)
  assert.match(pricingDefaults, /localMarketPricingEnabled: true/)
  assert.match(pricingDefaults, /localMarketPerMileCents: 400/)
  assert.match(pricingDefaults, /localMarketPerMinuteCents: 100/)
  assert.match(pricingDefaults, /airportFeeCents: 1000/)
  assert.match(pricingDefaults, /waitTimeGraceMinutes: 0/)
  assert.doesNotMatch(pricingDefaults, /airportMinimumFareCents|meetAndGreetFeeCents|parkingEstimateCents/)
  assert.doesNotMatch(pricingDefaults, /shortNoticeRules/)
  assert.doesNotMatch(admin, /Base service fee|Minimum fare|Short-notice thresholds/)
  assert.doesNotMatch(quotes, /Short-notice scheduling adjustment/)
})

test('booking can be installed from the branded home-screen prompt', () => {
  assert.match(html, /data-install-app/)
  assert.match(home, /class="quick-install-action"[^>]*data-open-install/)
  assert.match(home, /data-install-app/)
  assert.match(home, /rel="apple-touch-icon"/)
  assert.match(siteScript, /beforeinstallprompt/)
  assert.match(siteScript, /installTrigger\?\.addEventListener\('click', async/)
  assert.match(siteScript, /isIosChrome = isIos && \/CriOS\//)
  assert.match(siteScript, /In Chrome on iPhone or iPad: tap Share/)
  assert.match(siteScript, /deferredInstallPrompt\.prompt\(\)/)
  assert.doesNotMatch(siteScript, /window\.setTimeout\(showInstall/)
  assert.match(siteScript, /serviceWorker\.register\('\.\/sw\.js'\)/)
  assert.equal(JSON.parse(manifest).start_url, '/booking.html')
  assert.equal(JSON.parse(manifest).icons.some(icon => icon.sizes === '192x192'), true)
})

test('round trips receive an admin-managed fifteen percent discount', () => {
  assert.match(pricingDefaults, /roundTripDiscountEnabled: true/)
  assert.match(pricingDefaults, /roundTripDiscountPercentageBps: 1500/)
  assert.match(quotes, /args\.tripType === 'round_trip' && config\.roundTripDiscountEnabled/)
  assert.match(admin, /Enable automatic round-trip discount/)
  assert.match(html, /Round trip — save 15%/)
  assert.match(home, /Save 15% when you book a round trip/)
  assert.match(home, /Add return date · save 15%/)
})
