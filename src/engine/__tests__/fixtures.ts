import { DEFAULT_SETTINGS } from '../settings'
import { addDays } from '../dates'
import type { ZipDb } from '../zip'
import { lookupZip } from '../zip'
import { pointKey, type ForecastMap, type GeoPoint } from '../weather'
import type { DecideContext } from '../decide'
import type { LocationForecast, Settings } from '../types'

/** A handful of real zips so distances and states are realistic. */
export const ZIPS: ZipDb = {
  '67202': [37.69, -97.34, 'Wichita', 'KS'],
  '67206': [37.7, -97.23, 'Wichita', 'KS'],
  '64108': [39.08, -94.58, 'Kansas City', 'MO'],
  '75201': [32.79, -96.8, 'Dallas', 'TX'],
  '80202': [39.75, -104.99, 'Denver', 'CO'],
  '85004': [33.46, -112.07, 'Phoenix', 'AZ'],
  '33101': [25.78, -80.2, 'Miami', 'FL'],
  '98101': [47.61, -122.33, 'Seattle', 'WA'],
  '02138': [42.38, -71.13, 'Cambridge', 'MA'],
  '99501': [61.21, -149.88, 'Anchorage', 'AK'],
  '10001': [40.75, -74, 'New York', 'NY'],
}

export const ORIGIN = lookupZip(ZIPS, '67202')!

/** Thursday, 2026-09-17 — so a 3-day ground shipment crosses a weekend. */
export const TODAY = '2026-09-17'

/**
 * Builds a 16-day forecast for a point. `high` may be a number (flat) or a
 * function of day index so tests can shape the curve.
 */
export function forecast(p: GeoPoint, high: number | ((i: number) => number), low = 60, start = TODAY, days = 16): LocationForecast {
  const out: LocationForecast = { lat: p.lat, lon: p.lon, days: [], fetchedAt: 0, stale: false }
  for (let i = 0; i < days; i++) {
    const h = typeof high === 'function' ? high(i) : high
    out.days.push({ date: addDays(start, i), high: h, low: Math.min(low, h - 10) })
  }
  return out
}

export function forecastMap(entries: [GeoPoint, LocationForecast][]): ForecastMap {
  const m: ForecastMap = new Map()
  for (const [p, f] of entries) m.set(pointKey(p), f)
  return m
}

export function ctx(overrides: Partial<Omit<DecideContext, 'settings'>> & { settings?: Partial<Settings> } = {}): DecideContext {
  const { settings: partial, ...rest } = overrides
  const settings: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...(partial ?? {}) } as Settings
  return {
    settings,
    shipDate: TODAY,
    today: TODAY,
    origin: ORIGIN,
    zipDb: ZIPS,
    forecasts: new Map(),
    ...rest,
  }
}

export const place = (zip: string) => lookupZip(ZIPS, zip)!
