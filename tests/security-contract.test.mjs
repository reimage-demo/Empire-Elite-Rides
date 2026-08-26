import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const quotes = await readFile(new URL('../convex/quotes.ts', import.meta.url), 'utf8')
const reservations = await readFile(new URL('../convex/reservations.ts', import.meta.url), 'utf8')
const browser = await readFile(new URL('../booking.js', import.meta.url), 'utf8')
const adminAuth = await readFile(new URL('../convex/adminAuth.ts', import.meta.url), 'utf8')
const adminPortal = await readFile(new URL('../admin-portal/src/App.jsx', import.meta.url), 'utf8')
const adminSchema = await readFile(new URL('../convex/schema.ts', import.meta.url), 'utf8')
const sessionAuth = await readFile(new URL('../convex/lib/auth.ts', import.meta.url), 'utf8')
const pricingAdmin = await readFile(new URL('../convex/pricingAdmin.ts', import.meta.url), 'utf8')
const sessionTokens = await readFile(new URL('../convex/lib/sessionToken.ts', import.meta.url), 'utf8')
const stripeHttp = await readFile(new URL('../convex/http.ts', import.meta.url), 'utf8')
const stripeWebhook = await readFile(new URL('../convex/stripeWebhook.ts', import.meta.url), 'utf8')
const stripeWebhookCore = await readFile(new URL('../convex/lib/stripeWebhookCore.mjs', import.meta.url), 'utf8')
const payments = await readFile(new URL('../convex/payments.ts', import.meta.url), 'utf8')
const paymentRecords = await readFile(new URL('../convex/paymentRecords.ts', import.meta.url), 'utf8')
const promotions = await readFile(new URL('../convex/promotions.ts', import.meta.url), 'utf8')
const promotionsAdmin = await readFile(new URL('../convex/promotionsAdmin.ts', import.meta.url), 'utf8')
const siteScript = await readFile(new URL('../script.js', import.meta.url), 'utf8')

test('fixed operating base is backend-owned', async () => assert.match(await readFile(new URL('../convex/lib/defaultPricing.ts', import.meta.url), 'utf8'), /2603 2nd Ave, Watervliet, NY 12189/))
test('route, coordinates, and price are not accepted from quote browser arguments', () => {
  assert.doesNotMatch(quotes.match(/generateBookingQuote = action\([\s\S]*?handler:/)?.[0] || '', /priceCents|latitude|longitude|distanceMeters|durationSeconds/)
})
test('reservation submission preserves the stored backend quote price', () => {
  assert.match(reservations, /quote\.finalPriceCents/)
  assert.match(reservations, /quote\.expiresAt <= now/)
  assert.match(reservations, /quotedPriceCents/)
})
test('browser submits a quote id but never supplies a price', () => {
  const reservationCall = browser.match(/reservations:submit[^;]+/)?.[0] || ''
  assert.doesNotMatch(reservationCall, /price|amount|cents/i)
  const checkoutCall = browser.match(/payments:createCheckout[\s\S]*?\}\);/)?.[0] || ''
  assert.match(checkoutCall, /quoteId/)
  assert.doesNotMatch(checkoutCall, /price|amount|cents/i)
})
test('Geoapify key and accepted coordinates remain backend-owned', () => {
  assert.match(quotes, /process\.env\.GEOAPIFY_API_KEY/)
  assert.match(quotes, /api\.geoapify\.com\/v1\/geocode\/autocomplete/)
  assert.match(quotes, /api\.geoapify\.com\/v1\/routing/)
  assert.doesNotMatch(browser, /GEOAPIFY|geoapify\.com|apiKey/i)
})

test('admin passwords use hardened one-way verification', () => {
  assert.doesNotMatch(adminAuth, /ADMIN_PASSWORD(?!_(?:ALGORITHM|HASH|ITERATIONS|PEPPER|SALT))/)
  assert.match(adminAuth, /crypto\.subtle\.deriveBits/)
  assert.match(adminAuth, /MINIMUM_ITERATIONS = 600_000/)
  assert.match(adminAuth, /constantTimeBytesEqual/)
  assert.match(adminAuth, /crypto\.getRandomValues/)
})

test('admin logout invalidates the server session before clearing browser state', () => {
  assert.match(adminPortal, /useMutation\(api\.adminAuth\.logout\)/)
  assert.match(adminAuth, /ctx\.db\.delete\(session\._id\)/)
  assert.match(adminPortal, /finally \{ clearToken\(\) \}/)
  assert.match(adminPortal, /sessionStorage\.removeItem/)
})

test('admin login allows only four failures per lockout window', () => {
  assert.match(adminAuth, /MAXIMUM_FAILED_ATTEMPTS = 4/)
  assert.match(adminAuth, /LOGIN_LOCKOUT_MS = 15 \* 60 \* 1000/)
  assert.match(adminAuth, /attemptRecord\.count >= MAXIMUM_FAILED_ATTEMPTS/)
  assert.match(adminAuth, /ctx\.db\.delete\(attemptRecord\._id\)/)
})

test('only session token hashes are used for authentication', () => {
  assert.match(adminAuth, /tokenHash = await hashSessionToken\(token\)/)
  assert.match(adminAuth, /tokenHash,/)
  assert.match(sessionTokens, /by_token_hash/)
  assert.match(adminSchema, /tokenHash: v\.string\(\)/)
  assert.doesNotMatch(adminSchema, /by_token['"]/)
})

test('admin sessions expire after inactivity and have an absolute lifetime', () => {
  assert.match(sessionTokens, /SESSION_INACTIVITY_TIMEOUT_MS = 30 \* 60 \* 1000/)
  assert.match(sessionTokens, /SESSION_ABSOLUTE_LIFETIME_MS = 12 \* 60 \* 60 \* 1000/)
  assert.match(sessionTokens, /now - lastActiveAt >= SESSION_INACTIVITY_TIMEOUT_MS/)
  assert.match(adminPortal, /api\.adminAuth\.touchSession/)
  assert.match(adminPortal, /\['pointerdown', 'keydown', 'touchstart'\]/)
})

test('owner sessions can access and manage pricing', () => {
  assert.match(adminAuth, /\["owner", "admin", "manager", "dispatcher", "viewer"\]/)
  assert.match(sessionAuth, /ADMIN_ROLES = \['owner', 'admin', 'manager'\]/)
  assert.match(pricingAdmin, /\['owner', 'admin', 'manager', 'dispatcher', 'viewer'\]/)
  assert.match(pricingAdmin, /\['owner', 'admin', 'manager', 'dispatcher'\]/)
})

test('pricing query failures stay inside the pricing tab', () => {
  assert.match(adminPortal, /class PricingErrorBoundary extends Component/)
  assert.match(adminPortal, /<PricingErrorBoundary><PricingPanel token=\{token\}\/><\/PricingErrorBoundary>/)
})

test('Stripe webhook verifies the raw request before processing', () => {
  assert.match(stripeHttp, /const rawBody = await request\.text\(\)/)
  assert.match(stripeHttp, /constructEventAsync\(/)
  assert.match(stripeHttp, /process\.env\.STRIPE_WEBHOOK_SECRET/)
  assert.doesNotMatch(stripeHttp, /request\.json\(\)/)
})

test('paid checkout notifications are scheduled only after event idempotency', () => {
  const duplicateCheck = stripeWebhookCore.indexOf('if (existingEvent) return')
  const notificationSchedule = stripeWebhookCore.indexOf('ctx.scheduler.runAfter')
  assert.ok(duplicateCheck >= 0 && notificationSchedule > duplicateCheck)
  assert.match(stripeWebhookCore, /event\.paymentStatus === 'paid'/)
  assert.match(stripeWebhookCore, /withIndex\('by_event_id'/)
  assert.match(stripeWebhook, /processCheckoutCompleted/)
})

test('Stripe Checkout amount comes only from the persisted quote and booking', () => {
  assert.match(paymentRecords, /paymentAmountCents: quote\.finalPriceCents/)
  assert.match(payments, /unit_amount: booking\.amountCents/)
  assert.match(payments, /checkout\.amount_total !== booking\.amountCents/)
  assert.doesNotMatch(payments.match(/args: \{[\s\S]*?\n  \},\n  handler:/)?.[0] || '', /amount|price|cents/i)
})

test('promotion values remain backend-owned through Stripe checkout', () => {
  assert.match(promotionsAdmin, /percentageBps: args\.percentageBps/)
  assert.match(paymentRecords, /paymentAmountCents: quote\.finalPriceCents/)
  assert.match(paymentRecords, /promotionRedemptions/)
  assert.match(payments, /unit_amount: booking\.amountCents/)
  assert.doesNotMatch(payments.match(/args: \{[\s\S]*?\n  \},\n  handler:/)?.[0] || '', /promotion|discount|percentage/i)
})

test('automatic promotions are server-scheduled and shown once per campaign', () => {
  assert.match(promotions, /row\.startAt <= now/)
  assert.match(promotions, /row\.endAt > now/)
  assert.match(siteScript, /empireElitePromotionSeen:\$\{promotion\.id\}/)
  assert.match(siteScript, /promotion-banner/)
  assert.match(siteScript, /textContent = promotion\.headline/)
})

test('admin portal renders server-owned payment state and Stripe identifiers', () => {
  assert.match(adminPortal, /row\.paymentStatus/)
  assert.match(adminPortal, /row\.stripeCheckoutSessionId/)
  assert.match(adminPortal, /row\.stripePaymentIntentId/)
})
