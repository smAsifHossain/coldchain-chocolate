import type { Settings } from './types'

/**
 * Defaults reflect common chocolatier practice: cocoa butter softens around
 * 80 °F, so anything forecast above that gets ice packs. Every value is
 * editable in the Settings screen and persisted locally.
 */
export const DEFAULT_SETTINGS: Settings = {
  originZip: '67202',
  pickupCutoff: '15:00',
  observeHolidays: true,
  productRules: [
    { label: 'Cream centers: truffles, ganache, caramels, bonbons', pattern: 'truffle|ganache|caramel|bonbon|cream', offset: -5 },
    { label: 'White or milk chocolate', pattern: 'white|milk', offset: -3 },
  ],
  thresholds: { single: 65, double: 80, hold: 95 },
  coldRule: { enabled: false, below: 20 },
  transit: {
    zones: [
      { maxMiles: 150, days: 1 },
      { maxMiles: 600, days: 2 },
      { maxMiles: 1000, days: 3 },
      { maxMiles: 1400, days: 4 },
    ],
    farDays: 5,
    twoDayDays: 2,
    overnightDays: 1,
  },
  saturdayDelivery: false,
  porchDays: 1,
  routeWaypoint: true,
  longHotTransitDays: 4,
  materials: {
    linersByTier: { none: 0, single: 1, double: 2 },
    icePacksByTier: { none: 0, single: 0, double: 2 },
    icePackPerExtraDay: 1,
    extraDayThreshold: 2,
    icePackMax: 4,
  },
  costs: { liner: 1.85, icePack: 0.95 },
}

const STORAGE_KEY = 'coldchain.settings.v1'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Deep-merge a partial (possibly stale or hand-edited) object over the defaults. */
export function mergeSettings(partial: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  if (!isRecord(partial)) return structuredClone(base)
  const out = structuredClone(base) as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(partial)) {
    if (!(k in out)) continue
    const cur = out[k]
    if (isRecord(cur) && isRecord(v)) {
      out[k] = mergeSettings(v, cur as unknown as Settings) as unknown
    } else if (Array.isArray(cur) && Array.isArray(v)) {
      out[k] = v
    } else if (typeof cur === typeof v) {
      out[k] = v
    }
  }
  return out as unknown as Settings
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? mergeSettings(JSON.parse(raw)) : structuredClone(DEFAULT_SETTINGS)
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // Private mode or quota: settings still work for this session.
  }
}

/** Human-readable problems with a settings object, empty when valid. */
export function validateSettings(s: Settings): string[] {
  const problems: string[] = []
  const t = s.thresholds
  if (!(t.single < t.double)) problems.push('Single-thermal threshold must be below the double-thermal threshold.')
  if (!(t.double <= t.hold)) problems.push('Hold threshold must be at or above the double-thermal threshold.')
  if (!/^\d{5}$/.test(s.originZip)) problems.push('Origin zip must be 5 digits.')
  if (!/^\d{2}:\d{2}$/.test(s.pickupCutoff)) problems.push('Pickup time must look like 15:00.')
  for (const r of s.productRules) {
    try {
      new RegExp(r.pattern, 'i')
    } catch {
      problems.push(`Product rule "${r.label || r.pattern}" is not a valid pattern.`)
    }
    if (r.offset > 0) problems.push(`Product rule "${r.label}" raises the thresholds — rules can only make the call more careful.`)
  }
  let prev = 0
  for (const z of s.transit.zones) {
    if (z.maxMiles <= prev) problems.push('Transit zones must have increasing mile limits.')
    if (z.days < 1) problems.push('Transit days must be at least 1.')
    prev = z.maxMiles
  }
  if (s.porchDays < 0) problems.push('Porch days cannot be negative.')
  return problems
}
