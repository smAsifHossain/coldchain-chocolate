// The decision itself: from an order, a ship date, the settings and the
// forecasts, produce a tier plus every reason a packer would need to trust it.

import { addDays, daysBetween, formatShort, type ISODate } from './dates'
import { haversineMiles, lookupZip, midpoint, normalizeZip, type Place, type ZipDb } from './zip'
import {
  deliveryDate,
  effectiveShipDate,
  estimateTransitDays,
  inTransitDates,
  MILITARY,
  parseServiceLevel,
  SERVICE_LABEL,
  spansHoliday,
  spansWeekend,
} from './transit'
import { dayAt, pointKey, type ForecastMap, type GeoPoint } from './weather'
import type { Confidence, Decision, ExposurePoint, Order, Recommendation, ServiceLevel, Settings, Tier } from './types'

export interface DecideContext {
  settings: Settings
  shipDate: ISODate
  /** Today's date; forecast confidence is measured from here. */
  today: ISODate
  origin: Place
  zipDb: ZipDb
  forecasts: ForecastMap
}

export const TIER_LABEL: Record<Tier, string> = {
  none: 'No thermal',
  single: 'Single thermal',
  double: 'Double thermal + ice packs',
}

export const TIER_RANK: Record<Tier, number> = { none: 0, single: 1, double: 2 }

export interface ResolvedOrder {
  zip: string | null
  place: Place | null
  note: string | null
  nonUS: boolean
}

function isUS(country: string | undefined): boolean {
  if (!country) return true
  const c = country.trim().toLowerCase()
  return c === '' || c === 'us' || c === 'usa' || c === 'united states' || c === 'united states of america'
}

export function resolveOrder(order: Order, zipDb: ZipDb): ResolvedOrder {
  if (!isUS(order.country)) return { zip: null, place: null, note: `Ships to ${order.country}`, nonUS: true }
  const norm = normalizeZip(order.zip)
  if (!norm.zip) return { zip: null, place: null, note: norm.note, nonUS: false }
  const place = lookupZip(zipDb, norm.zip)
  if (!place) return { zip: norm.zip, place: null, note: `Zip ${norm.zip} is not in the zip table`, nonUS: false }
  // A zip that lands in a different state than the order says is more likely a typo than a move.
  const claimed = (order.state ?? '').trim().toUpperCase()
  if (claimed.length === 2 && claimed !== place.state) {
    return {
      zip: norm.zip,
      place: null,
      note: `Zip ${norm.zip} is in ${place.state} but the order says ${claimed}${norm.note ? ` (${norm.note.toLowerCase()})` : ''}`,
      nonUS: false,
    }
  }
  return { zip: norm.zip, place, note: norm.note, nonUS: false }
}

/** Every location whose forecast this order needs. */
export function pointsForOrder(order: Order, ctx: Pick<DecideContext, 'settings' | 'origin' | 'zipDb'>): GeoPoint[] {
  const r = resolveOrder(order, ctx.zipDb)
  if (!r.place) return []
  const pts: GeoPoint[] = [ctx.origin, r.place]
  if (ctx.settings.routeWaypoint) pts.push(midpoint(ctx.origin.lat, ctx.origin.lon, r.place.lat, r.place.lon))
  return pts
}

export function placeLabel(p: Place): string {
  return `${p.city}, ${p.state}`
}

type Thresholds = Settings['thresholds']

function tierFor(high: number, t: Thresholds): Tier {
  if (high >= t.double) return 'double'
  if (high >= t.single) return 'single'
  return 'none'
}

/**
 * Thresholds for this box: the most sensitive matching product rule lowers
 * every threshold. Rules can only make the call more careful.
 */
export function thresholdsForOrder(order: Order, s: Settings): { thresholds: Thresholds; rule: Settings['productRules'][number] | null } {
  const items = (order.lineItems ?? []).join(' | ')
  let best: Settings['productRules'][number] | null = null
  if (items) {
    for (const r of s.productRules) {
      let re: RegExp
      try {
        re = new RegExp(r.pattern, 'i')
      } catch {
        continue
      }
      if (r.offset < 0 && re.test(items) && (!best || r.offset < best.offset)) best = r
    }
  }
  if (!best) return { thresholds: s.thresholds, rule: null }
  const o = best.offset
  return {
    thresholds: { single: s.thresholds.single + o, double: s.thresholds.double + o, hold: s.thresholds.hold + o },
    rule: best,
  }
}

export function materialsFor(tier: Tier, transitDays: number, s: Settings): { liners: number; icePacks: number; cost: number; note: string | null } {
  const m = s.materials
  const liners = m.linersByTier[tier]
  let icePacks = m.icePacksByTier[tier]
  let note: string | null = null
  if (icePacks > 0 && transitDays > m.extraDayThreshold) {
    const extra = (transitDays - m.extraDayThreshold) * m.icePackPerExtraDay
    const capped = Math.min(m.icePackMax, icePacks + extra)
    note = `${icePacks} ice pack${icePacks === 1 ? '' : 's'} for the tier + ${extra} for ${transitDays - m.extraDayThreshold} transit day${transitDays - m.extraDayThreshold === 1 ? '' : 's'} beyond ${m.extraDayThreshold}${capped < icePacks + extra ? ` (capped at ${m.icePackMax})` : ''}`
    icePacks = capped
  }
  const cost = liners * s.costs.liner + icePacks * s.costs.icePack
  return { liners, icePacks, cost: Math.round(cost * 100) / 100, note }
}

function confidenceFor(furthestDate: ISODate, today: ISODate): Confidence {
  const d = daysBetween(today, furthestDate)
  if (d <= 7) return 'high'
  if (d <= 14) return 'medium'
  return 'low'
}

function fmtTemp(t: number): string {
  return `${Math.round(t)}°F`
}

interface WindowBuild {
  window: ExposurePoint[]
  worst: ExposurePoint | null
  coldest: ExposurePoint | null
  missingDates: ISODate[]
}

function buildWindow(
  dest: Place,
  shipDate: ISODate,
  delivery: ISODate,
  ctx: DecideContext,
): WindowBuild {
  const { settings, origin, forecasts } = ctx
  const originFc = forecasts.get(pointKey(origin))
  const destFc = forecasts.get(pointKey(dest))
  const mid = settings.routeWaypoint ? midpoint(origin.lat, origin.lon, dest.lat, dest.lon) : null
  const midFc = mid ? forecasts.get(pointKey(mid)) : undefined

  const window: ExposurePoint[] = []
  const push = (date: ISODate, place: string, role: ExposurePoint['role'], fc: typeof originFc) => {
    const day = dayAt(fc, date)
    window.push({ date, place, role, high: day?.high ?? null, low: day?.low ?? null })
  }

  push(shipDate, placeLabel(origin), 'origin', originFc)
  for (const d of inTransitDates(shipDate, delivery)) {
    if (mid) push(d, 'Route midpoint', 'route', midFc)
    push(d, placeLabel(dest), 'transit', destFc)
  }
  push(delivery, placeLabel(dest), 'destination', destFc)
  for (let i = 1; i <= settings.porchDays; i++) push(addDays(delivery, i), placeLabel(dest), 'porch', destFc)

  let worst: ExposurePoint | null = null
  let coldest: ExposurePoint | null = null
  const missing = new Set<ISODate>()
  for (const p of window) {
    if (p.high === null || p.low === null) {
      missing.add(p.date)
      continue
    }
    if (!worst || p.high > worst.high!) worst = p
    if (!coldest || p.low < coldest.low!) coldest = p
  }
  return { window, worst, coldest, missingDates: [...missing] }
}

/** A pickup is exposed only on the day it is collected, at the origin. */
function buildPickupWindow(date: ISODate, ctx: DecideContext): WindowBuild {
  const originFc = ctx.forecasts.get(pointKey(ctx.origin))
  const day = dayAt(originFc, date)
  const point: ExposurePoint = { date, place: placeLabel(ctx.origin), role: 'origin', high: day?.high ?? null, low: day?.low ?? null }
  const ok = point.high !== null && point.low !== null
  return { window: [point], worst: ok ? point : null, coldest: ok ? point : null, missingDates: ok ? [] : [date] }
}

interface DecideOptions {
  /** Skip the search for better ship dates / service levels (used when evaluating alternatives). */
  noAlternatives?: boolean
  serviceOverride?: ServiceLevel
  shipDateOverride?: ISODate
}

function reviewDecision(order: Order, resolved: ResolvedOrder, ctx: DecideContext, reason: string): Decision {
  const s = ctx.settings
  const tier: Tier = 'double'
  const mats = materialsFor(tier, s.transit.farDays, s)
  const label = order.city && order.state ? `${order.city}, ${order.state}` : order.city || order.country || ''
  return {
    orderId: order.id,
    thresholds: s.thresholds,
    zip: resolved.zip ?? String(order.zip ?? ''),
    place: label,
    status: 'needs_review',
    serviceLevel: order.serviceLevel ?? parseServiceLevel(order.shippingMethod),
    distanceMiles: null,
    transitDays: s.transit.farDays,
    shipDate: ctx.shipDate,
    deliveryDate: ctx.shipDate,
    window: [],
    worst: null,
    coldest: null,
    tier,
    liners: mats.liners,
    icePacks: mats.icePacks,
    cost: mats.cost,
    recommendation: null,
    warnings: [reason, 'Defaulted to the safest tier — check this address by hand.'],
    reasons: [],
    confidence: 'none',
  }
}

export function decide(order: Order, ctx: DecideContext, opts: DecideOptions = {}): Decision {
  const s = ctx.settings
  const resolved = resolveOrder(order, ctx.zipDb)
  if (resolved.nonUS) return reviewDecision(order, resolved, ctx, `${resolved.note} — only US zips are forecast.`)
  if (!resolved.place || !resolved.zip) return reviewDecision(order, resolved, ctx, resolved.note ?? 'Address could not be located.')

  const dest = resolved.place
  const warnings: string[] = []
  const reasons: string[] = []
  if (resolved.note) warnings.push(resolved.note)
  if (order.address && /\bP\.?\s?O\.?\s?box\b/i.test(order.address)) {
    warnings.push('PO Box address — UPS and FedEx cannot deliver here; ship USPS.')
  }

  const service = opts.serviceOverride ?? order.serviceLevel ?? parseServiceLevel(order.shippingMethod)
  const distance = haversineMiles(ctx.origin.lat, ctx.origin.lon, dest.lat, dest.lon)
  const transit = estimateTransitDays(distance, dest.state, service, s)
  const { thresholds: th, rule } = thresholdsForOrder(order, s)
  const pickup = service === 'pickup'

  const requested = opts.shipDateOverride ?? ctx.shipDate
  // A pickup happens whenever the customer walks in; shipments wait for the next carrier day.
  const ship = pickup ? { date: requested, shifted: false, holiday: false } : effectiveShipDate(requested, s.observeHolidays)
  if (ship.shifted) {
    warnings.push(
      `${formatShort(requested)} is a ${ship.holiday ? 'carrier holiday' : 'weekend'} — no pickup, so this ships ${formatShort(ship.date)}.`,
    )
  }
  const delivery = pickup ? ship.date : deliveryDate(ship.date, transit.days, s.saturdayDelivery, s.observeHolidays)

  if (pickup) {
    reasons.push(`Store pickup — judged on ${placeLabel(ctx.origin)}'s high the day it is collected, ${formatShort(ship.date)}.`)
  } else {
    reasons.push(`${transit.basis} → ${transit.days} transit day${transit.days === 1 ? '' : 's'}, delivered ${formatShort(delivery)}.`)
  }
  if (transit.nonContiguous && service === 'ground') {
    warnings.push(
      MILITARY.has(dest.state)
        ? 'Military address — USPS only, and transit can take weeks. Ice will not last; ship the least heat-sensitive products or hold for cooler weather.'
        : `Ground to ${dest.state} is slow and unpredictable — consider air service.`,
    )
  }
  if (!pickup && s.observeHolidays) {
    const hol = spansHoliday(ship.date, delivery)
    if (hol) warnings.push(`${formatShort(hol)} is a carrier holiday — the box sits still that day; delivery already accounts for it.`)
  }
  if (rule) {
    reasons.push(`${rule.label} in the box — thresholds lowered ${Math.abs(rule.offset)}°F (single from ${th.single}°F, double from ${th.double}°F).`)
  }

  const built = pickup ? buildPickupWindow(ship.date, ctx) : buildWindow(dest, ship.date, delivery, ctx)

  if (!built.worst) {
    const mats = materialsFor('double', transit.days, s)
    return {
      orderId: order.id,
      thresholds: th,
      zip: resolved.zip,
      place: placeLabel(dest),
      status: 'no_forecast',
      serviceLevel: service,
      distanceMiles: Math.round(distance),
      transitDays: transit.days,
      shipDate: ship.date,
      deliveryDate: delivery,
      window: built.window,
      worst: null,
      coldest: null,
      tier: 'double',
      liners: mats.liners,
      icePacks: mats.icePacks,
      cost: mats.cost,
      recommendation: null,
      warnings: [...warnings, 'No forecast is available for this window — defaulted to the safest tier. Check the weather by hand.'],
      reasons,
      confidence: 'none',
    }
  }

  const worst = built.worst
  let tier = tierFor(worst.high!, th)
  const roleText: Record<ExposurePoint['role'], string> = {
    origin: pickup ? 'pickup day' : 'ship day',
    route: 'in transit',
    transit: 'in transit',
    destination: 'delivery day',
    porch: 'day after delivery',
  }
  const threshold = tier === 'double' ? `≥ ${th.double}°F` : tier === 'single' ? `≥ ${th.single}°F` : `< ${th.single}°F`
  reasons.unshift(
    `Worst case ${fmtTemp(worst.high!)} in ${worst.place} on ${formatShort(worst.date)} (${roleText[worst.role]}) — ${threshold} → ${TIER_LABEL[tier]}.`,
  )

  if (s.coldRule.enabled && built.coldest && built.coldest.low! < s.coldRule.below && tier === 'none') {
    tier = 'single'
    reasons.push(`Low of ${fmtTemp(built.coldest.low!)} in ${built.coldest.place} on ${formatShort(built.coldest.date)} is below ${s.coldRule.below}°F → liner added for cold protection.`)
  }

  if (built.missingDates.length > 0) {
    warnings.push(`No forecast yet for ${built.missingDates.map(formatShort).join(', ')} — decision uses the days that are available.`)
  }
  if (!pickup && tier !== 'none' && spansWeekend(ship.date, delivery)) {
    warnings.push('Sits in a carrier hub over the weekend. Shipping Monday–Wednesday avoids this.')
  }

  const mats = materialsFor(tier, transit.days, s)
  if (mats.note) reasons.push(mats.note + '.')

  const furthest = built.window[built.window.length - 1]?.date ?? delivery
  let confidence = confidenceFor(furthest, ctx.today)
  if (built.missingDates.length > 0) confidence = 'low'

  let recommendation: Recommendation | null = null
  if (!opts.noAlternatives) {
    const tooHot = worst.high! >= th.hold
    const longHot = tier === 'double' && transit.days >= s.longHotTransitDays
    if (!pickup && (tooHot || longHot)) {
      recommendation = recommend(order, ctx, { service, tier, worstHigh: worst.high!, tooHot, transitDays: transit.days })
    }
  }

  return {
    orderId: order.id,
    thresholds: th,
    zip: resolved.zip,
    place: placeLabel(dest),
    status: 'ok',
    serviceLevel: service,
    distanceMiles: Math.round(distance),
    transitDays: transit.days,
    shipDate: ship.date,
    deliveryDate: delivery,
    window: built.window,
    worst,
    coldest: built.coldest,
    tier,
    liners: mats.liners,
    icePacks: mats.icePacks,
    cost: mats.cost,
    recommendation,
    warnings,
    reasons,
    confidence,
  }
}

interface RecommendInput {
  service: ServiceLevel
  tier: Tier
  worstHigh: number
  tooHot: boolean
  transitDays: number
}

function recommend(order: Order, ctx: DecideContext, input: RecommendInput): Recommendation {
  const s = ctx.settings
  const th = thresholdsForOrder(order, s).thresholds
  const why = input.tooHot
    ? `Worst case ${fmtTemp(input.worstHigh)} is at or above the ${th.hold}°F hold threshold.`
    : `${input.transitDays} days in transit at double-thermal temperatures is a long time on ice.`

  // Alternative 1: faster service.
  let expedite: { level: ServiceLevel; d: Decision } | null = null
  if (input.service === 'ground') {
    const alt = decide(order, ctx, { noAlternatives: true, serviceOverride: 'two_day' })
    if (alt.status === 'ok' && alt.worst && (alt.worst.high! < th.hold || TIER_RANK[alt.tier] < TIER_RANK[input.tier])) {
      expedite = { level: 'two_day', d: alt }
    }
  }

  // Alternative 2: a cooler ship day in the next week.
  const better = findBetterShipDate(order, ctx, input.tier, input.tooHot ? th.hold : undefined)

  const parts: string[] = [why]
  if (expedite) {
    parts.push(`Upgrade to ${SERVICE_LABEL[expedite.level]}: delivered ${formatShort(expedite.d.deliveryDate)}, worst case ${fmtTemp(expedite.d.worst!.high!)} → ${TIER_LABEL[expedite.d.tier]}.`)
  }
  if (better) {
    parts.push(`Or hold until ${formatShort(better.shipDate)}: worst case ${fmtTemp(better.worst!.high!)} → ${TIER_LABEL[better.tier]}.`)
  }
  if (!expedite && !better) {
    parts.push('No cooler option in the next 7 days — ship with maximum protection or call the customer.')
  }

  const action: Recommendation['action'] = expedite && expedite.d.worst!.high! < th.hold ? 'expedite' : better ? 'hold' : 'expedite'
  return { action, detail: parts.join(' '), holdUntil: better?.shipDate }
}

/**
 * First ship date within `horizonDays` whose decision is a lower tier (and,
 * if `belowHigh` is given, whose worst case is below it). Null when none.
 */
export function findBetterShipDate(
  order: Order,
  ctx: DecideContext,
  currentTier: Tier,
  belowHigh?: number,
  horizonDays = 7,
): Decision | null {
  for (let i = 1; i <= horizonDays; i++) {
    const candidate = addDays(ctx.shipDate, i)
    const eff = effectiveShipDate(candidate, ctx.settings.observeHolidays)
    if (eff.date !== candidate) continue
    const d = decide(order, ctx, { noAlternatives: true, shipDateOverride: candidate })
    if (d.status !== 'ok' || !d.worst || d.confidence === 'low') continue
    const lowerTier = TIER_RANK[d.tier] < TIER_RANK[currentTier]
    const coolEnough = belowHigh === undefined ? true : d.worst.high! < belowHigh
    if (coolEnough && (lowerTier || belowHigh !== undefined)) return d
  }
  return null
}

/** Tier for each of the next `days` ship dates — the planner grid. */
export function planShipDays(order: Order, ctx: DecideContext, days = 7): { shipDate: ISODate; decision: Decision }[] {
  const out: { shipDate: ISODate; decision: Decision }[] = []
  for (let i = 0; i < days; i++) {
    const shipDate = addDays(ctx.shipDate, i)
    out.push({ shipDate, decision: decide(order, ctx, { noAlternatives: true, shipDateOverride: shipDate }) })
  }
  return out
}
