import { mutation, query } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { requireAdmin } from './lib/auth'
import { DEFAULT_PRICING } from './lib/defaultPricing'
import { mergePricingSnapshot } from './lib/pricingConfig.mjs'

const fail = (message: string): never => { throw new ConvexError({ code: 'INVALID_ADMIN_INPUT', message }) }

function validateConfig(config: any) {
  const centFields = [
    'passengerPerMileCents', 'passengerPerMinuteCents', 'positioningPerMileCents',
    'positioningPerMinuteCents', 'returnPerMileCents', 'returnPerMinuteCents', 'minimumFareCents',
    'eventMinimumFareCents', 'hourlyRateCents', 'waitTimePerMinuteCents',
    'additionalStopFeeCents', 'airportFeeCents', 'limitedAvailabilityAdjustmentCents',
    'fuelCostPerMileCents', 'vehicleWearPerMileCents', 'chauffeurLaborPerMinuteCents', 'cleaningCostCents',
    'competitiveLongDistanceBaseFeeCents', 'competitiveLongDistanceFirstTierPerMileCents',
    'competitiveLongDistancePerMileCents', 'competitiveLongDistancePerMinuteCents',
    'competitiveLongDistanceMaximumPositioningChargeCents', 'localMarketPerMileCents', 'localMarketPerMinuteCents'
  ]
  for (const field of centFields) if (!Number.isInteger(config[field]) || config[field] < 0 || config[field] > 10_000_000) fail(`${field} must be a non-negative integer number of cents.`)
  const percentageFields = ['taxPercentageBps', 'gratuityPercentageBps', 'targetMarginBps']
  for (const field of percentageFields) if (!Number.isInteger(config[field]) || config[field] < 0 || config[field] > 10000) fail(`${field} must be between 0 and 10000 basis points.`)
  if (!Number.isInteger(config.competitiveLongDistanceThresholdMiles) || config.competitiveLongDistanceThresholdMiles < 1) fail('The competitive long-distance threshold must be at least one mile.')
  for (const field of ['competitiveLongDistanceEnabled', 'competitiveLongDistanceAllowBelowCostFloor', 'competitiveLongDistanceRequiresReview', 'localMarketPricingEnabled', 'localMarketAllowBelowCostFloor']) {
    if (typeof config[field] !== 'boolean') fail(`${field} must be enabled or disabled.`)
  }
  if (!Array.isArray(config.rushHourRules) || !Array.isArray(config.afterHoursRules)) fail('Time adjustment rules must remain configured arrays.')
}

export const dashboard = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    await requireAdmin(ctx, sessionToken, ['owner', 'admin', 'manager', 'dispatcher', 'viewer'])
    const configs = await ctx.db.query('pricingConfigs').withIndex('by_active', q => q.eq('active', true)).collect()
    const config = configs.sort((a, b) => b.version - a.version)[0]
    const holidays = await ctx.db.query('holidayRules').collect()
    const events = await ctx.db.query('specialEventRules').collect()
    const blocks = await ctx.db.query('blackoutPeriods').collect()
    const audit = (await ctx.db.query('auditLogs').withIndex('by_timestamp').order('desc').take(50))
    const effectiveConfig = config ? { ...config, snapshot: mergePricingSnapshot(DEFAULT_PRICING, config.snapshot) } : { version: 0, snapshot: DEFAULT_PRICING, createdBy: 'not saved yet', createdAt: 0 }
    return { config: effectiveConfig, holidays, events, blocks, audit }
  }
})

export const saveConfig = mutation({
  args: { sessionToken: v.string(), snapshot: v.any(), reason: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.sessionToken)
    validateConfig(args.snapshot)
    if (args.reason.trim().length < 3) fail('Enter a reason for the pricing change.')
    const active = await ctx.db.query('pricingConfigs').withIndex('by_active', q => q.eq('active', true)).collect()
    const previous = active.sort((a, b) => b.version - a.version)[0]
    for (const row of active) await ctx.db.patch(row._id, { active: false })
    const now = Date.now(), version = (previous?.version || 0) + 1
    const id = await ctx.db.insert('pricingConfigs', { version, effectiveAt: now, createdBy: admin.username, createdAt: now, snapshot: { ...args.snapshot, ownerReviewRequired: false }, active: true })
    await ctx.db.insert('auditLogs', { userId: admin.username, action: 'pricing_config_created', entityType: 'pricingConfig', entityId: String(id), previousValues: previous?.snapshot, newValues: args.snapshot, reason: args.reason.trim(), timestamp: now })
    return { version }
  }
})

export const addHoliday = mutation({
  args: { sessionToken: v.string(), name: v.string(), startAt: v.number(), endAt: v.number(), flatCents: v.number(), percentageBps: v.number(), manualApproval: v.boolean(), notes: v.optional(v.string()) },
  handler: async (ctx, { sessionToken, ...rule }) => {
    const admin = await requireAdmin(ctx, sessionToken)
    if (rule.name.trim().length < 2 || rule.endAt <= rule.startAt || rule.flatCents < 0 || rule.percentageBps < 0 || rule.percentageBps > 10000) fail('Review the holiday name, dates, and adjustment.')
    const now = Date.now(), id = await ctx.db.insert('holidayRules', { ...rule, name: rule.name.trim(), active: true, createdAt: now, updatedAt: now })
    await ctx.db.insert('auditLogs', { userId: admin.username, action: 'holiday_created', entityType: 'holidayRule', entityId: String(id), newValues: rule, timestamp: now })
  }
})

export const toggleHoliday = mutation({
  args: { sessionToken: v.string(), id: v.id('holidayRules'), active: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.sessionToken), previous = await ctx.db.get(args.id)
    if (!previous) fail('Holiday rule not found.')
    await ctx.db.patch(args.id, { active: args.active, updatedAt: Date.now() })
    await ctx.db.insert('auditLogs', { userId: admin.username, action: args.active ? 'holiday_enabled' : 'holiday_disabled', entityType: 'holidayRule', entityId: String(args.id), previousValues: { active: previous!.active }, newValues: { active: args.active }, timestamp: Date.now() })
  }
})

export const addEvent = mutation({
  args: { sessionToken: v.string(), name: v.string(), startAt: v.number(), endAt: v.number(), flatCents: v.number(), percentageBps: v.number(), manualApproval: v.boolean(), displayName: v.boolean() },
  handler: async (ctx, { sessionToken, ...rule }) => {
    const admin = await requireAdmin(ctx, sessionToken)
    if (rule.name.trim().length < 2 || rule.endAt <= rule.startAt || rule.flatCents < 0 || rule.percentageBps < 0 || rule.percentageBps > 10000) fail('Review the event name, dates, and adjustment.')
    const now = Date.now(), id = await ctx.db.insert('specialEventRules', { ...rule, name: rule.name.trim(), active: true, createdAt: now, updatedAt: now })
    await ctx.db.insert('auditLogs', { userId: admin.username, action: 'event_created', entityType: 'specialEventRule', entityId: String(id), newValues: rule, timestamp: now })
  }
})

export const toggleEvent = mutation({
  args: { sessionToken: v.string(), id: v.id('specialEventRules'), active: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.sessionToken), previous = await ctx.db.get(args.id)
    if (!previous) fail('Event rule not found.')
    await ctx.db.patch(args.id, { active: args.active, updatedAt: Date.now() })
    await ctx.db.insert('auditLogs', { userId: admin.username, action: args.active ? 'event_enabled' : 'event_disabled', entityType: 'specialEventRule', entityId: String(args.id), previousValues: { active: previous!.active }, newValues: { active: args.active }, timestamp: Date.now() })
  }
})

export const addBlackout = mutation({
  args: { sessionToken: v.string(), startAt: v.number(), endAt: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.sessionToken, ['owner', 'admin', 'manager', 'dispatcher'])
    if (args.endAt <= args.startAt || args.reason.trim().length < 3) fail('Review the blocked dates and internal reason.')
    const now = Date.now(), id = await ctx.db.insert('blackoutPeriods', { startAt: args.startAt, endAt: args.endAt, reason: args.reason.trim(), active: true, createdBy: admin.username, createdAt: now, updatedAt: now })
    await ctx.db.insert('auditLogs', { userId: admin.username, action: 'blackout_created', entityType: 'blackoutPeriod', entityId: String(id), newValues: { startAt: args.startAt, endAt: args.endAt, reason: args.reason }, timestamp: now })
  }
})

export const toggleBlackout = mutation({
  args: { sessionToken: v.string(), id: v.id('blackoutPeriods'), active: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.sessionToken, ['owner', 'admin', 'manager', 'dispatcher']), previous = await ctx.db.get(args.id)
    if (!previous) fail('Blackout period not found.')
    await ctx.db.patch(args.id, { active: args.active, updatedAt: Date.now() })
    await ctx.db.insert('auditLogs', { userId: admin.username, action: args.active ? 'blackout_enabled' : 'blackout_disabled', entityType: 'blackoutPeriod', entityId: String(args.id), previousValues: { active: previous!.active }, newValues: { active: args.active }, timestamp: Date.now() })
  }
})
