import { mutation, query } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { requireActiveSession } from './lib/sessionToken'
import { bookingBlocksAvailability } from './lib/bookingState'

const TWO_HOURS = 2 * 60 * 60 * 1000
const status = v.union(v.literal('payment_pending'), v.literal('requested'), v.literal('manual_review'), v.literal('confirmed'), v.literal('completed'), v.literal('cancelled'), v.literal('refunded'))

function timeValue(date: string, time: string) {
  return Date.parse(`${date}T${time}:00.000Z`)
}

function bookingError(code: string, message: string): never {
  throw new ConvexError({ code, message })
}

function newYorkNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).reduce<Record<string, string>>((result, part) => {
    result[part.type] = part.value
    return result
  }, {})
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

function minutesFromTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function timeFromMinutes(total: number) {
  const safe = Math.max(0, Math.min(total, 24 * 60))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

async function requireAdmin(ctx: any, token: string) {
  return await requireActiveSession(ctx, token)
}

async function insertBooking(ctx: any, args: any, source: 'website' | 'admin') {
  const startAt = timeValue(args.serviceDate, args.startTime)
  const endAt = timeValue(args.serviceDate, args.endTime)
  const nowInNewYork = newYorkNow()
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) bookingError('INVALID_TIME_RANGE', 'End time must be later than start time.')
  if (args.fullName.trim().length < 2 || (args.email && !args.email.includes('@')) || args.phone.trim().length < 7) bookingError('INVALID_CONTACT_DETAILS', 'Please provide valid contact details.')
  if (args.contactMethod === 'email' && !args.email) bookingError('INVALID_CONTACT_DETAILS', 'An email address is required when email is the preferred contact method.')
  if (!args.eventType.trim()) bookingError('INVALID_OCCASION', 'Please choose an occasion.')
  if (!/^\d{2}:(00|30)$/.test(args.startTime) || !/^\d{2}:(00|30)$/.test(args.endTime)) bookingError('INVALID_TIME_INTERVAL', 'Please choose times in 30-minute intervals.')
  if (args.phone.replace(/\D/g, '').length !== 10) bookingError('INVALID_PHONE', 'Please provide a complete 10-digit phone number.')
  if (args.serviceDate < nowInNewYork.date) bookingError('PAST_DATE', 'Please choose a future date.')
  if (args.serviceDate === nowInNewYork.date && nowInNewYork.hour >= 12) bookingError('SAME_DAY_CUTOFF', 'Same-day reservations must be requested before 12:00 PM Eastern Time.')

  const possibleConflicts = await ctx.db.query('bookings').withIndex('by_start', (q: any) => q.lt('startAt', endAt + TWO_HOURS)).collect()
  const conflict = possibleConflicts.some((row: any) => bookingBlocksAvailability(row) && startAt < row.endAt + TWO_HOURS && endAt + TWO_HOURS > row.startAt)
  if (conflict) bookingError('TIME_UNAVAILABLE', 'That time is unavailable because it overlaps a booking or its two-hour service buffer.')

  const now = Date.now()
  const confirmationCode = `EER-${now.toString(36).slice(-6).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`
  const normalizedEmail = args.email?.trim().toLowerCase() || undefined
  const id = await ctx.db.insert('bookings', {
    ...args,
    email: normalizedEmail,
    fullName: args.fullName.trim(),
    phone: args.phone.trim(),
    pickupAddress: args.pickupAddress.trim(),
    destination: args.destination.trim(),
    notes: args.notes.trim(),
    confirmationCode,
    startAt,
    endAt,
    source,
    status: source === 'admin' ? 'confirmed' : 'requested',
    paymentStatus: 'not_required',
    createdAt: now,
    updatedAt: now
  })
  await ctx.scheduler.runAfter(0, internal.notifications.sendBooking, {
    bookingId: String(id),
    confirmationCode,
    source,
    fullName: args.fullName.trim(),
    phone: args.phone.trim(),
    email: normalizedEmail,
    contactMethod: args.contactMethod,
    eventType: args.eventType,
    tripType: args.tripType,
    serviceDate: args.serviceDate,
    startTime: args.startTime,
    endTime: args.endTime,
    pickupAddress: args.pickupAddress.trim(),
    destination: args.destination.trim(),
    notes: args.notes.trim() || undefined
  })
  return { id, confirmationCode }
}

export const create = mutation({
  args: {
    fullName: v.string(), email: v.string(), phone: v.string(),
    contactMethod: v.union(v.literal('text'), v.literal('call'), v.literal('email')),
    eventCategory: v.optional(v.string()),
    eventType: v.string(),
    tripType: v.union(v.literal('pickup'), v.literal('dropoff'), v.literal('both')),
    serviceDate: v.string(), startTime: v.string(), endTime: v.string(),
    pickupAddress: v.string(), destination: v.string(), notes: v.string()
  },
  handler: async (ctx, args) => insertBooking(ctx, args, 'website')
})

export const createAdmin = mutation({
  args: {
    sessionToken: v.string(),
    fullName: v.string(), email: v.optional(v.string()), phone: v.string(),
    contactMethod: v.union(v.literal('text'), v.literal('call'), v.literal('email')),
    eventType: v.string(),
    tripType: v.union(v.literal('pickup'), v.literal('dropoff'), v.literal('both')),
    serviceDate: v.string(), startTime: v.string(), endTime: v.string(),
    pickupAddress: v.string(), destination: v.string(), notes: v.string()
  },
  handler: async (ctx, { sessionToken, ...args }) => {
    await requireAdmin(ctx, sessionToken)
    return insertBooking(ctx, args, 'admin')
  }
})

export const availabilityForDate = query({
  args: { serviceDate: v.string() },
  handler: async (ctx, { serviceDate }) => {
    const rows = await ctx.db.query('bookings').withIndex('by_date', q => q.eq('serviceDate', serviceDate)).collect()
    return rows
      .filter(row => bookingBlocksAvailability(row))
      .map(row => ({
        unavailableFrom: row.startTime,
        unavailableUntil: timeFromMinutes(minutesFromTime(row.endTime) + 120)
      }))
      .sort((a, b) => a.unavailableFrom.localeCompare(b.unavailableFrom))
  }
})

export const adminList = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    await requireAdmin(ctx, sessionToken)
    return ctx.db.query('bookings').withIndex('by_start').order('desc').collect()
  }
})

export const updateStatus = mutation({
  args: { sessionToken: v.string(), id: v.id('bookings'), status },
  handler: async (ctx, { sessionToken, id, status: nextStatus }) => {
    const admin = await requireAdmin(ctx, sessionToken)
    const previous = await ctx.db.get(id)
    if (!previous) bookingError('BOOKING_NOT_FOUND', 'Booking not found.')
    await ctx.db.patch(id, { status: nextStatus, updatedAt: Date.now() })
    await ctx.db.insert('auditLogs', { userId: admin.username, action: 'booking_status_changed', entityType: 'booking', entityId: String(id), previousValues: { status: previous!.status }, newValues: { status: nextStatus }, timestamp: Date.now() })
  }
})
