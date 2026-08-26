import test from 'node:test'
import assert from 'node:assert/strict'
import Stripe from 'stripe'
import { processCheckoutCompleted } from '../convex/lib/stripeWebhookCore.mjs'

function harness(overrides = {}) {
  const booking = {
    _id: 'booking_1', confirmationCode: 'EER-PAID01', status: 'payment_pending',
    paymentStatus: 'checkout_pending', paymentAmountCents: 18750, paymentCurrency: 'usd',
    stripeCheckoutSessionId: 'cs_test_1', ...overrides
  }
  const tables = { bookings: [booking], stripeWebhookEvents: [] }
  const scheduled = []
  const db = {
    query(table) {
      return {
        withIndex(_index, build) {
          const filters = []
          const builder = { eq(field, value) { filters.push([field, value]); return builder } }
          build(builder)
          return {
            async unique() {
              const rows = tables[table].filter(row => filters.every(([field, value]) => row[field] === value))
              if (rows.length > 1) throw new Error('Expected a unique row')
              return rows[0] || null
            }
          }
        }
      }
    },
    normalizeId(table, id) { return tables[table].some(row => row._id === id) ? id : null },
    async get(id) { return Object.values(tables).flat().find(row => row._id === id) || null },
    async insert(table, value) { const row = { _id: `${table}_${tables[table].length + 1}`, ...value }; tables[table].push(row); return row._id },
    async patch(id, value) { const row = Object.values(tables).flat().find(item => item._id === id); Object.assign(row, value) }
  }
  return { ctx: { db, scheduler: { async runAfter(delay, fn, args) { scheduled.push({ delay, fn, args }) } } }, booking, tables, scheduled }
}

const paidEvent = {
  stripeEventId: 'evt_paid_1', eventType: 'checkout.session.completed', stripeCreatedAt: 1760000000,
  livemode: false, checkoutSessionId: 'cs_test_1', paymentStatus: 'paid',
  amountTotal: 18750, currency: 'usd', bookingId: 'booking_1', confirmationCode: 'EER-PAID01',
  paymentIntentId: 'pi_test_1', stripeCustomerId: 'cus_test_1'
}

test('Stripe signature verification accepts the exact raw body and rejects a changed body', async () => {
  const stripe = new Stripe('synthetic_test_only')
  const secret = 'whsec_synthetic_test_only'
  const rawBody = JSON.stringify({ id: 'evt_synthetic', type: 'checkout.session.completed' })
  const signature = stripe.webhooks.generateTestHeaderString({ payload: rawBody, secret })
  const event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret)
  assert.equal(event.id, 'evt_synthetic')
  await assert.rejects(() => stripe.webhooks.constructEventAsync(`${rawBody} `, signature, secret))
})

test('verified paid Checkout patches the exact admin booking and schedules Pushover once', async () => {
  const state = harness()
  const result = await processCheckoutCompleted(state.ctx, paidEvent, 'sendPaidCheckout')

  assert.equal(result.processingStatus, 'processed')
  assert.equal(result.bookingId, state.booking._id)
  assert.equal(state.booking.paymentStatus, 'paid')
  assert.equal(state.booking.status, 'requested')
  assert.equal(state.booking.stripeCheckoutSessionId, 'cs_test_1')
  assert.equal(state.booking.stripePaymentIntentId, 'pi_test_1')
  assert.equal(state.tables.bookings[0], state.booking, 'admin query reads the same patched booking record')
  assert.equal(state.tables.stripeWebhookEvents[0].bookingId, state.booking._id)
  assert.equal(state.tables.stripeWebhookEvents[0].processingStatus, 'processed')
  assert.equal(state.scheduled.length, 1)
  assert.equal(state.scheduled[0].fn, 'sendPaidCheckout')
  assert.equal(state.scheduled[0].args.bookingId, state.booking._id)
  assert.equal(state.scheduled[0].args.amountTotal, state.booking.paymentAmountCents)

  const replay = await processCheckoutCompleted(state.ctx, paidEvent, 'sendPaidCheckout')
  assert.equal(replay.duplicate, true)
  assert.equal(state.scheduled.length, 1, 'same Stripe event cannot schedule another notification')

  await processCheckoutCompleted(state.ctx, { ...paidEvent, stripeEventId: 'evt_paid_2' }, 'sendPaidCheckout')
  assert.equal(state.scheduled.length, 1, 'a second paid event cannot notify after the booking is already paid')
})

test('amount mismatch never marks the booking paid or schedules Pushover', async () => {
  const state = harness()
  const result = await processCheckoutCompleted(state.ctx, { ...paidEvent, amountTotal: 1 }, 'sendPaidCheckout')
  assert.equal(result.processingStatus, 'amount_mismatch')
  assert.equal(state.booking.paymentStatus, 'checkout_pending')
  assert.equal(state.booking.status, 'payment_pending')
  assert.equal(state.scheduled.length, 0)
})

test('paid admin checkout preserves confirmed booking status', async () => {
  const state = harness({ status: 'confirmed', source: 'admin' })
  await processCheckoutCompleted(state.ctx, paidEvent, 'sendPaidCheckout')
  assert.equal(state.booking.paymentStatus, 'paid')
  assert.equal(state.booking.status, 'confirmed')
  assert.equal(state.scheduled.length, 1)
})
