// Forecast client. Open-Meteo first: keyless, CORS-open, 16 days, many
// locations per request. If it is down, the National Weather Service (also
// keyless, 7 days, one location per call) fills in. Results are cached locally
// so a flaky connection degrades to "the last saved forecast, clearly labeled"
// rather than a blank page.

import type { DailyForecast, LocationForecast } from './types'

export interface GeoPoint {
  lat: number
  lon: number
}

export const pointKey = (p: GeoPoint): string => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`

export type ForecastMap = Map<string, LocationForecast>

export interface ForecastCache {
  get(key: string): LocationForecast | undefined
  set(key: string, value: LocationForecast): void
}

export interface FetchOptions {
  now?: number
  fetchImpl?: typeof fetch
  cache?: ForecastCache
  /** Reuse a cached forecast younger than this without calling the API. */
  ttlMs?: number
  batchSize?: number
  forecastDays?: number
  /** How many points to try against the NWS when Open-Meteo fails (each is two requests). */
  nwsMaxPoints?: number
}

export interface FetchResult {
  forecasts: ForecastMap
  /** Keys that have neither a fresh nor a cached forecast. */
  missing: string[]
  /** Keys served from cache because the refresh failed. */
  stale: string[]
  /** Keys served by the National Weather Service because Open-Meteo failed. */
  fallback: string[]
  errors: string[]
}

const API = 'https://api.open-meteo.com/v1/forecast'
const NWS = 'https://api.weather.gov'
const DEFAULT_TTL = 6 * 60 * 60 * 1000
/** NWS is one location per two requests; cap how many we try when Open-Meteo is down. */
const NWS_MAX_POINTS = 40

interface OpenMeteoLocation {
  latitude: number
  longitude: number
  daily?: {
    time: string[]
    temperature_2m_max: (number | null)[]
    temperature_2m_min: (number | null)[]
  }
}

function toForecast(p: GeoPoint, raw: OpenMeteoLocation, now: number): LocationForecast {
  const days: DailyForecast[] = []
  const d = raw.daily
  if (d) {
    for (let i = 0; i < d.time.length; i++) {
      const high = d.temperature_2m_max[i]
      const low = d.temperature_2m_min[i]
      if (high === null || low === null) continue
      days.push({ date: d.time[i], high, low })
    }
  }
  return { lat: p.lat, lon: p.lon, days, fetchedAt: now, stale: false }
}

async function fetchBatch(points: GeoPoint[], opts: Required<Pick<FetchOptions, 'fetchImpl' | 'forecastDays'>>): Promise<OpenMeteoLocation[]> {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(2)).join(','),
    longitude: points.map((p) => p.lon.toFixed(2)).join(','),
    daily: 'temperature_2m_max,temperature_2m_min',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
    forecast_days: String(opts.forecastDays),
  })
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await opts.fetchImpl(`${API}?${params}`)
      if (res.status === 429 || res.status >= 500) throw new Error(`Open-Meteo responded ${res.status}`)
      if (!res.ok) {
        let reason = ''
        try {
          reason = ((await res.json()) as { reason?: string }).reason ?? ''
        } catch {
          // body was not JSON
        }
        throw new Error(`Open-Meteo rejected the request${reason ? `: ${reason}` : ` (${res.status})`}`)
      }
      const body = (await res.json()) as OpenMeteoLocation | OpenMeteoLocation[]
      const list = Array.isArray(body) ? body : [body]
      if (list.length !== points.length) throw new Error('Open-Meteo returned a different number of locations than requested')
      return list
    } catch (err) {
      lastError = err
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

interface NwsPeriod {
  startTime: string
  isDaytime: boolean
  temperature: number
  temperatureUnit: string
}

/**
 * National Weather Service: /points resolves the grid, then /forecast gives
 * 7 days of day/night periods. Daytime periods are highs, night periods lows.
 */
async function fetchNws(p: GeoPoint, fetchImpl: typeof fetch, now: number): Promise<LocationForecast> {
  const pt = await fetchImpl(`${NWS}/points/${p.lat.toFixed(4)},${p.lon.toFixed(4)}`, { headers: { Accept: 'application/geo+json' } })
  if (!pt.ok) throw new Error(`NWS points ${pt.status}`)
  const url = ((await pt.json()) as { properties?: { forecast?: string } }).properties?.forecast
  if (!url) throw new Error('NWS has no forecast for this point')
  const fc = await fetchImpl(url, { headers: { Accept: 'application/geo+json' } })
  if (!fc.ok) throw new Error(`NWS forecast ${fc.status}`)
  const periods = ((await fc.json()) as { properties?: { periods?: NwsPeriod[] } }).properties?.periods ?? []
  const highs = new Map<string, number>()
  const lows = new Map<string, number>()
  for (const per of periods) {
    const date = per.startTime.slice(0, 10)
    const temp = per.temperatureUnit === 'C' ? (per.temperature * 9) / 5 + 32 : per.temperature
    if (per.isDaytime) highs.set(date, Math.max(highs.get(date) ?? -Infinity, temp))
    else lows.set(date, Math.min(lows.get(date) ?? Infinity, temp))
  }
  const days: DailyForecast[] = []
  for (const [date, high] of highs) days.push({ date, high, low: lows.get(date) ?? high - 15 })
  days.sort((a, b) => (a.date < b.date ? -1 : 1))
  return { lat: p.lat, lon: p.lon, days, fetchedAt: now, stale: false, source: 'nws' }
}

/**
 * Returns a forecast for every distinct point. Fresh cache hits are used as-is;
 * everything else is fetched in batches. On failure, any cached copy (however
 * old) is returned flagged `stale`; points with no copy at all are `missing`.
 */
export async function getForecasts(points: GeoPoint[], options: FetchOptions = {}): Promise<FetchResult> {
  const now = options.now ?? Date.now()
  const ttl = options.ttlMs ?? DEFAULT_TTL
  const batchSize = options.batchSize ?? 50
  const fetchImpl: typeof fetch = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const forecastDays = options.forecastDays ?? 16
  const cache = options.cache

  const unique = new Map<string, GeoPoint>()
  for (const p of points) unique.set(pointKey(p), { lat: Number(p.lat.toFixed(2)), lon: Number(p.lon.toFixed(2)) })

  const result: FetchResult = { forecasts: new Map(), missing: [], stale: [], fallback: [], errors: [] }
  const toFetch: GeoPoint[] = []

  for (const [key, p] of unique) {
    const cached = cache?.get(key)
    if (cached && now - cached.fetchedAt < ttl && cached.days.length > 0) {
      result.forecasts.set(key, { ...cached, stale: false })
    } else {
      toFetch.push(p)
    }
  }

  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize)
    try {
      const raw = await fetchBatch(batch, { fetchImpl, forecastDays })
      batch.forEach((p, idx) => {
        const fc = { ...toForecast(p, raw[idx], now), source: 'open-meteo' as const }
        const key = pointKey(p)
        result.forecasts.set(key, fc)
        cache?.set(key, fc)
      })
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err))
      let nwsBudget = options.nwsMaxPoints ?? NWS_MAX_POINTS
      let nwsFailed = false
      for (const p of batch) {
        const key = pointKey(p)
        // Second provider first, then whatever the cache still holds.
        if (nwsBudget > 0 && !nwsFailed) {
          nwsBudget--
          try {
            const fc = await fetchNws(p, fetchImpl, now)
            if (fc.days.length > 0) {
              result.forecasts.set(key, fc)
              result.fallback.push(key)
              cache?.set(key, fc)
              continue
            }
          } catch (e) {
            nwsFailed = true
            result.errors.push(`NWS: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        const cached = cache?.get(key)
        if (cached && cached.days.length > 0) {
          result.forecasts.set(key, { ...cached, stale: true })
          result.stale.push(key)
        } else {
          result.missing.push(key)
        }
      }
    }
  }
  return result
}

export function dayAt(fc: LocationForecast | undefined, date: string): DailyForecast | null {
  if (!fc) return null
  return fc.days.find((d) => d.date === date) ?? null
}

/** localStorage-backed cache; silently no-ops when storage is unavailable. */
export function createLocalCache(storageKey = 'coldchain.forecast.v1'): ForecastCache {
  let mem: Record<string, LocationForecast> = {}
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) mem = JSON.parse(raw) as Record<string, LocationForecast>
  } catch {
    mem = {}
  }
  const persist = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(mem))
    } catch {
      // Quota exceeded or private mode: keep the in-memory copy only.
    }
  }
  return {
    get: (key) => mem[key],
    set: (key, value) => {
      mem[key] = value
      persist()
    },
  }
}

let shared: ForecastCache | null = null

/** The one localStorage-backed cache every part of the app shares. */
export function sharedForecastCache(): ForecastCache {
  if (!shared) shared = createLocalCache()
  return shared
}

export function createMemoryCache(): ForecastCache {
  const mem = new Map<string, LocationForecast>()
  return { get: (k) => mem.get(k), set: (k, v) => void mem.set(k, v) }
}
