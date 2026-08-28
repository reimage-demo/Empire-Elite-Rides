import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { FLEET, publicVehicle, syncFleet } from './lib/fleet'

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const stored = await ctx.db.query('vehicles').collect()
    return FLEET
      .filter(definition => stored.find(row => row.key === definition.key)?.active !== false)
      .map(definition => publicVehicle({ ...definition, ...stored.find(row => row.key === definition.key) }))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }
})

// Safe, idempotent catalog sync used during deployments and before writes that assign a vehicle.
export const syncCatalog = mutation({
  args: {},
  handler: async (ctx) => {
    const records = await syncFleet(ctx)
    return records.map(publicVehicle)
  }
})
