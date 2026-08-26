import { internalQuery, query } from './_generated/server'
import { v } from 'convex/values'

function isEligible(row: any, now: number, serviceType?: string) {
  return Boolean(
    row.active &&
    (row.kind || 'code') === 'automatic' &&
    row.startAt <= now &&
    row.endAt > now &&
    row.uses < row.usageLimit &&
    (!serviceType || !row.serviceTypes.length || row.serviceTypes.includes(serviceType))
  )
}

function bestAutomatic(rows: any[], now: number, serviceType?: string) {
  return rows
    .filter(row => isEligible(row, now, serviceType))
    .sort((a, b) => b.percentageBps - a.percentageBps || b.flatDiscountCents - a.flatDiscountCents || b.updatedAt - a.updatedAt)[0] || null
}

function pricingCandidate(row: any) {
  if (!row) return null
  return {
    promotionId: row._id,
    kind: row.kind || 'code',
    name: row.name || 'Website promotion',
    discountLabel: row.name || 'Website promotion',
    flatDiscountCents: row.flatDiscountCents,
    percentageBps: row.percentageBps,
    maximumDiscountCents: row.maximumDiscountCents,
    minimumBookingCents: row.minimumBookingCents,
    allowBelowMinimum: row.allowBelowMinimum,
    startAt: row.startAt,
    endAt: row.endAt
  }
}

export const activeAutomatic = internalQuery({
  args: { now: v.number(), serviceType: v.optional(v.string()) },
  handler: async (ctx, args) => pricingCandidate(bestAutomatic(await ctx.db.query('promotions').withIndex('by_active', q => q.eq('active', true)).collect(), args.now, args.serviceType))
})

export const currentWebsitePromotion = query({
  args: {},
  handler: async ctx => {
    const row = bestAutomatic(await ctx.db.query('promotions').withIndex('by_active', q => q.eq('active', true)).collect(), Date.now())
    if (!row) return null
    return {
      id: row._id,
      name: row.name || 'Limited-time offer',
      headline: row.publicHeadline || `${row.percentageBps / 100}% off chauffeur service`,
      message: row.publicMessage || 'Your promotional savings will be applied automatically when you calculate your ride price.',
      percentageBps: row.percentageBps,
      startAt: row.startAt,
      endAt: row.endAt,
      updatedAt: row.updatedAt
    }
  }
})
