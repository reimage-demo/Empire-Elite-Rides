export const FLEET = [
  {
    key: 'ford-expedition-2017',
    name: '2017 Ford Expedition Limited',
    make: 'Ford',
    model: 'Expedition Limited',
    year: 2017,
    vehicleClass: 'Full-size luxury SUV',
    powertrain: 'Gasoline',
    color: 'Black',
    passengerCapacity: 7,
    luggageCapacity: 6,
    description: 'Spacious full-size SUV for larger groups, airport luggage, and family travel.',
    imageUrl: 'assets/images/vehicle/expedition-city-hero.png',
    sortOrder: 1
  },
  {
    key: 'lincoln-nautilus-hybrid-2025',
    name: '2025 Lincoln Nautilus Hybrid',
    make: 'Lincoln',
    model: 'Nautilus Hybrid',
    year: 2025,
    vehicleClass: 'Midsize luxury hybrid SUV',
    powertrain: '2.0L turbocharged hybrid AWD',
    color: 'Whisper Blue Metallic',
    passengerCapacity: 4,
    luggageCapacity: 4,
    description: 'Quiet, refined hybrid comfort for couples, executives, and smaller groups.',
    imageUrl: 'assets/images/vehicle/lincoln-nautilus-whisper-blue.png',
    sortOrder: 2
  }
] as const

export type FleetKey = typeof FLEET[number]['key']

export function fleetVehicle(key: string) {
  return FLEET.find(vehicle => vehicle.key === key) || null
}

export function publicVehicle(vehicle: any) {
  return {
    key: vehicle.key,
    name: vehicle.name,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    vehicleClass: vehicle.vehicleClass,
    powertrain: vehicle.powertrain,
    color: vehicle.color,
    passengerCapacity: vehicle.passengerCapacity,
    luggageCapacity: vehicle.luggageCapacity,
    description: vehicle.description,
    imageUrl: vehicle.imageUrl,
    sortOrder: vehicle.sortOrder
  }
}

export async function syncFleet(ctx: any) {
  const now = Date.now()
  const records = []
  for (const vehicle of FLEET) {
    let existing = await ctx.db.query('vehicles').withIndex('by_key', (query: any) => query.eq('key', vehicle.key)).unique()
    if (!existing) {
      existing = (await ctx.db.query('vehicles').collect()).find((row: any) => row.name === vehicle.name || (row.make === vehicle.make && row.year === vehicle.year && row.model === vehicle.model))
    }
    if (existing) {
      await ctx.db.patch(existing._id, { ...vehicle, active: existing.active !== false, updatedAt: now })
      records.push({ ...existing, ...vehicle, active: existing.active !== false, updatedAt: now })
    } else {
      const _id = await ctx.db.insert('vehicles', { ...vehicle, active: true, createdAt: now, updatedAt: now })
      records.push({ _id, ...vehicle, active: true, createdAt: now, updatedAt: now })
    }
  }
  return records
}

export async function requireFleetVehicle(ctx: any, key: string) {
  const definition = fleetVehicle(key)
  if (!definition) return null
  const records = await syncFleet(ctx)
  return records.find((vehicle: any) => vehicle.key === key && vehicle.active) || null
}
