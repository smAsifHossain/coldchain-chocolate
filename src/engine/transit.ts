import { addDays, dayOfWeek, dateRange, type ISODate } from './dates'
import { NON_CONTIGUOUS } from './zip'
import type { ServiceLevel, Settings } from './types'

/** Maps free-text Shopify shipping methods onto a service level. */
export function parseServiceLevel(method: string | undefined | null): ServiceLevel {
  const m = (method ?? '').toLowerCase()
  if (/overnight|next[\s-]?day|priority overnight|1[\s-]?day|express saver|first overnight/.test(m)) {
    return 'overnight'
  }
  if (/2nd[\s-]?day|two[\s-]?day|2[\s-]?day|second[\s-]?day|express(?!\s*saver)|priority mail express/.test(m)) {
    return 'two_day'
  }
  return 'ground'
}

export const SERVICE_LABEL: Record<ServiceLevel, string> = {
  ground: 'Ground',
  two_day: '2-Day',
  overnight: 'Overnight',
}

export interface TransitEstimate {
  days: number
  /** Why this number: zone, service level, or non-contiguous flag. */
  basis: string
  nonContiguous: boolean
}

export function estimateTransitDays(
  distanceMiles: number | null,
  state: string | undefined,
  service: ServiceLevel,
  settings: Settings,
): TransitEstimate {
  const nonContiguous = !!state && NON_CONTIGUOUS.has(state)
  if (service === 'overnight') {
    return { days: settings.transit.overnightDays, basis: 'Overnight service', nonContiguous }
  }
  if (service === 'two_day') {
    return { days: settings.transit.twoDayDays, basis: '2-Day service', nonContiguous }
  }
  if (nonContiguous) {
    return { days: settings.transit.farDays, basis: `Ground to ${state}`, nonContiguous }
  }
  if (distanceMiles === null) {
    return { days: settings.transit.farDays, basis: 'Distance unknown — assumed longest ground transit', nonContiguous }
  }
  for (const zone of settings.transit.zones) {
    if (distanceMiles <= zone.maxMiles) {
      return { days: zone.days, basis: `Ground, ${Math.round(distanceMiles)} mi (≤${zone.maxMiles} mi zone)`, nonContiguous }
    }
  }
  return { days: settings.transit.farDays, basis: `Ground, ${Math.round(distanceMiles)} mi (beyond last zone)`, nonContiguous }
}

/** Carriers pick up Monday–Friday; a weekend ship date effectively ships Monday. */
export function effectiveShipDate(shipDate: ISODate): { date: ISODate; shifted: boolean } {
  let d = shipDate
  let shifted = false
  while (dayOfWeek(d) === 0 || dayOfWeek(d) === 6) {
    d = addDays(d, 1)
    shifted = true
  }
  return { date: d, shifted }
}

/**
 * Counts transit days over days the carrier moves packages: Mon–Fri, plus
 * Saturday when the carrier delivers on Saturdays. Sunday never counts.
 */
export function deliveryDate(shipDate: ISODate, transitDays: number, saturdayDelivery: boolean): ISODate {
  let d = shipDate
  let remaining = transitDays
  while (remaining > 0) {
    d = addDays(d, 1)
    const dow = dayOfWeek(d)
    if (dow === 0) continue
    if (dow === 6 && !saturdayDelivery) continue
    remaining--
  }
  return d
}

/** Calendar days strictly between ship and delivery: the package is on a truck or in a hub. */
export function inTransitDates(shipDate: ISODate, delivery: ISODate): ISODate[] {
  const all = dateRange(shipDate, delivery)
  return all.slice(1, -1)
}

/** True when the package sits over a Saturday and Sunday in transit. */
export function spansWeekend(shipDate: ISODate, delivery: ISODate): boolean {
  const between = inTransitDates(shipDate, delivery)
  return between.some((d) => dayOfWeek(d) === 6) && between.some((d) => dayOfWeek(d) === 0)
}
