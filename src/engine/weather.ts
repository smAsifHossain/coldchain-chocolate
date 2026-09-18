// Open-Meteo client: keyless, CORS-open, 16-day daily forecast, many
// locations per request. Results are cached locally so a flaky connection
// degrades to "yesterday's forecast, clearly labeled" rather than a blank page.

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
}

export interface FetchResult {
  forecasts: ForecastMap
  /** Keys that have neither a fresh nor a cached forecast. */
  missing: string[]
  /** Keys served from cache because the refresh failed. */
  stale: string[]
  errors: string[]
}

const API = 'https://api.open-meteo.com/v1/forecast'
const DEFAULT_TTL = 6 * 60 * 60 * 1000

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

  const result: FetchResult = { forecasts: new Map(), missing: [], stale: [], errors: [] }
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
        const fc = toForecast(p, raw[idx], now)
        const key = pointKey(p)
        result.forecasts.set(key, fc)
        cache?.set(key, fc)
      })
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err))
      for (const p of batch) {
        const key = pointKey(p)
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
