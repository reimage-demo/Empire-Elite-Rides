import { mutation, query } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import { requireAdmin } from './lib/auth'

const campaignKind = v.union(v.literal('code'), v.literal('automatic'))
const fail = (message: string): never => { throw new ConvexError({ code: 'INVALID_PROMOTION', message }) }
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomCode(prefix = 'ELITE') {
  const bytes = crypto.getRandomValues(new Uint8Array(7))
  return `${prefix}-${Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')}`
}

function normalizeCode(value?: string) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '-')
}

async function uniqueCode(ctx: any, requested?: string): Promise<string> {
  const normalized = normalizeCode(requested)
  if (normalized && !/^[A-Z0-9-]{4,30}$/.test(normalized)) fail('Codes must be 4–30 characters using letters, numbers, and hyphens.')
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = normalized || randomCode()
    if (!await ctx.db.query('promotions').withIndex('by_code', (q: any) => q.eq('code', candidate)).unique()) return candidate
    if (normalized) fail('That promotion code already exists.')
  }
  return fail('A unique code could not be generated. Please try again.')
}

async function ensureNoAutomaticOverlap(ctx: any, startAt: number, endAt: number, ignoreId?: any) {
  const rows = await ctx.db.query('promotions').withIndex('by_active', (q: any) => q.eq('active', true)).collect()
  if (rows.some((row: any) => row._id !== ignoreId && row.kind === 'automatic' && row.startAt < endAt && row.endAt > startAt)) {
    fail('Automatic website promotions cannot overlap. Adjust the schedule or disable the existing promotion.')
  }
}

export const dashboard = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    await requireAdmin(ctx, sessionToken, ['owner', 'admin', 'manager', 'dispatcher', 'viewer'])
    return (await ctx.db.query('promotions').collect()).sort((a, b) => b.createdAt - a.createdAt)
  }
})

export const create = mutation({
  args: {
    sessionToken: v.string(), kind: campaignKind, name: v.string(), code: v.optional(v.string()),
    publicHeadline: v.optional(v.string()), publicMessage: v.optional(v.string()), percentageBps: v.number(),
    maximumDiscountCents: v.number(), minimumBookingCents: v.number(), usageLimit: v.number(),
    serviceTypes: v.array(v.string()), allowBelowMinimum: v.boolean(), startAt: v.number(), endAt: v.number()
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.sessionToken)
    const name = args.name.trim()
    if (name.length < 3) fail('Enter a campaign name.')
    if (!Number.isInteger(args.percentageBps) || args.percentageBps < 1 || args.percentageBps > 5000) fail('Percentage must be between 0.01% and 50%.')
    if (!Number.isInteger(args.usageLimit) || args.usageLimit < 1 || args.usageLimit > 1_000_000) fail('Usage limit must be between 1 and 1,000,000.')
    if (args.endAt <= args.startAt) fail('Expiration must be after the scheduled start.')
    if (args.kind === 'automatic') {
      if ((args.publicHeadline || '').trim().length < 4 || (args.publicMessage || '').trim().length < 8) fail('Add a public headline and message for the website promotion.')
      await ensureNoAutomaticOverlap(ctx, args.startAt, args.endAt)
    }
    const code = await uniqueCode(ctx, args.kind === 'code' ? args.code : undefined)
    const now = Date.now()
    const id = await ctx.db.insert('promotions', {
      code, kind: args.kind, name, publicHeadline: args.publicHeadline?.trim() || undefined,
      publicMessage: args.publicMessage?.trim() || undefined, flatDiscountCents: 0,
      percentageBps: args.percentageBps, maximumDiscountCents: args.maximumDiscountCents,
      minimumBookingCents: args.minimumBookingCents, startAt: args.startAt, endAt: args.endAt,
      usageLimit: args.usageLimit, uses: 0, serviceTypes: args.serviceTypes,
      allowBelowMinimum: args.allowBelowMinimum, active: true, createdBy: admin.username, createdAt: now, updatedAt: now
    })
    await ctx.db.insert('auditLogs', { userId: admin.username, action: 'promotion_created', entityType: 'promotion', entityId: String(id), newValues: { kind: args.kind, name, code: args.kind === 'code' ? code : undefined, percentageBps: args.percentageBps, startAt: args.startAt, endAt: args.endAt }, timestamp: now })
    return { id, code: args.kind === 'code' ? code : undefined }
  }
})

export const toggle = mutation({
  args: { sessionToken: v.string(), id: v.id('promotions'), active: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.sessionToken)
    const rawRow = await ctx.db.get(args.id)
    if (!rawRow) fail('Promotion not found.')
    const row = rawRow!
    if (args.active && row.kind === 'automatic') await ensureNoAutomaticOverlap(ctx, row.startAt, row.endAt, row._id)
    const now = Date.now()
    await ctx.db.patch(args.id, { active: args.active, updatedAt: now })
    await ctx.db.insert('auditLogs', { userId: admin.username, action: args.active ? 'promotion_enabled' : 'promotion_disabled', entityType: 'promotion', entityId: String(args.id), previousValues: { active: row.active }, newValues: { active: args.active }, timestamp: now })
  }
})
