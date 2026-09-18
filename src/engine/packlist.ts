// A pack list is the day's decisions plus any packer overrides, with the
// material counts and cost the bench needs to pull from the shelf.

import { materialsFor, TIER_RANK } from './decide'
import type { Decision, Order, Settings, Tier } from './types'

/** What the packer changed by hand on one line: the tier, a note, and how many boxes it ships as. */
export interface Override {
  tier?: Tier
  note?: string
  boxes?: number
}

export interface PackLine {
  order: Order
  decision: Decision
  override?: Override
}

export function effectiveTier(line: PackLine): Tier {
  return line.override?.tier ?? line.decision.tier
}

export function boxesFor(line: PackLine): number {
  const b = line.override?.boxes
  return b && b > 0 ? Math.round(b) : 1
}

/** True when the packer has actually changed the tier (a note or box count alone is not an override). */
export function tierOverridden(line: PackLine): boolean {
  return line.override?.tier !== undefined && line.override.tier !== line.decision.tier
}

export interface LineMaterials {
  liners: number
  icePacks: number
  cost: number
}

/** Materials for the tier actually being packed, times the number of boxes. */
export function lineMaterials(line: PackLine, settings: Settings): LineMaterials {
  const boxes = boxesFor(line)
  const tier = effectiveTier(line)
  const m =
    tier === line.decision.tier
      ? { liners: line.decision.liners, icePacks: line.decision.icePacks, cost: line.decision.cost }
      : materialsFor(tier, line.decision.transitDays, settings)
  return { liners: m.liners * boxes, icePacks: m.icePacks * boxes, cost: Math.round(m.cost * boxes * 100) / 100 }
}

export interface PackSummary {
  orders: number
  boxes: number
  byTier: Record<Tier, number>
  liners: number
  icePacks: number
  cost: number
  needsReview: number
  recommendations: number
  overrides: number
  stale: boolean
}

export function summarize(lines: PackLine[], settings: Settings, stale = false): PackSummary {
  const s: PackSummary = {
    orders: lines.length,
    boxes: 0,
    byTier: { none: 0, single: 0, double: 0 },
    liners: 0,
    icePacks: 0,
    cost: 0,
    needsReview: 0,
    recommendations: 0,
    overrides: 0,
    stale,
  }
  for (const line of lines) {
    const tier = effectiveTier(line)
    const m = lineMaterials(line, settings)
    if (line.decision.status === 'ok') s.byTier[tier]++
    s.boxes += boxesFor(line)
    s.liners += m.liners
    s.icePacks += m.icePacks
    s.cost += m.cost
    if (line.decision.status !== 'ok') s.needsReview++
    if (line.decision.recommendation) s.recommendations++
    if (tierOverridden(line)) s.overrides++
  }
  s.cost = Math.round(s.cost * 100) / 100
  return s
}

/** Hottest and most urgent first, so the bench sees the risky boxes at the top. */
export function sortForBench(lines: PackLine[]): PackLine[] {
  return [...lines].sort((a, b) => {
    const ra = a.decision.status !== 'ok' ? 3 : TIER_RANK[effectiveTier(a)]
    const rb = b.decision.status !== 'ok' ? 3 : TIER_RANK[effectiveTier(b)]
    if (rb !== ra) return rb - ra
    const ha = a.decision.worst?.high ?? -Infinity
    const hb = b.decision.worst?.high ?? -Infinity
    if (hb !== ha) return hb - ha
    return a.decision.orderId.localeCompare(b.decision.orderId, undefined, { numeric: true })
  })
}
