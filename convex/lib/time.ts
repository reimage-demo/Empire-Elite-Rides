import { ConvexError } from 'convex/values'

const TZ = 'America/New_York'

function partsFor(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(new Date(timestamp)).reduce<Record<string, string>>((result, part) => {
    result[part.type] = part.value
    return result
  }, {})
}

export function localPickupToUtc(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new ConvexError({ code: 'INVALID_PICKUP_TIME', message: 'Choose a valid pickup date and time.' })
  const target = `${date} ${time}`
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const naive = Date.UTC(year, month - 1, day, hour, minute)
  const candidates: number[] = []
  for (const offsetHours of [-5, -4]) {
    const candidate = naive - offsetHours * 3600000
    const parts = partsFor(candidate)
    if (`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}` === target) candidates.push(candidate)
  }
  if (!candidates.length) throw new ConvexError({ code: 'INVALID_LOCAL_TIME', message: 'That local time does not exist because of daylight saving time. Choose another time.' })
  // During the repeated fall-back hour, use the earlier instant consistently.
  return Math.min(...candidates)
}

export function localParts(timestamp: number) {
  const parts = partsFor(timestamp)
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday: weekdays[parts.weekday] }
}
