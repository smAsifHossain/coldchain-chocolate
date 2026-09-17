import { describe, expect, it, vi } from 'vitest'
import { createMemoryCache, getForecasts, pointKey } from '../weather'

const A = { lat: 37.69, lon: -97.34 }
const B = { lat: 33.46, lon: -112.07 }

function apiBody(points: { lat: number; lon: number }[], high = 90) {
  const one = (p: { lat: number; lon: number }) => ({
    latitude: p.lat,
    longitude: p.lon,
    daily: {
      time: ['2026-09-17', '2026-09-18'],
      temperature_2m_max: [high, high + 1],
      temperature_2m_min: [70, 71],
    },
  })
  return points.length === 1 ? one(points[0]) : points.map(one)
}

function okFetch(high = 90) {
  return vi.fn(async (url: string) => {
    const u = new URL(url)
    const lats = u.searchParams.get('latitude')!.split(',').map(Number)
    const lons = u.searchParams.get('longitude')!.split(',').map(Number)
    const pts = lats.map((lat, i) => ({ lat, lon: lons[i] }))
    return new Response(JSON.stringify(apiBody(pts, high)), { status: 200 })
  }) as unknown as typeof fetch
}

describe('getForecasts', () => {
  it('fetches distinct points in one batch and parses days', async () => {
    const fetchImpl = okFetch()
    const r = await getForecasts([A, B, A], { fetchImpl, now: 1000 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(r.forecasts.size).toBe(2)
    expect(r.forecasts.get(pointKey(B))!.days[0]).toEqual({ date: '2026-09-17', high: 90, low: 70 })
    expect(r.missing).toEqual([])
    expect(r.errors).toEqual([])
  })

  it('handles the single-location (non-array) response shape', async () => {
    const r = await getForecasts([A], { fetchImpl: okFetch(), now: 1000 })
    expect(r.forecasts.get(pointKey(A))!.days).toHaveLength(2)
  })

  it('splits large requests into batches', async () => {
    const fetchImpl = okFetch()
    const pts = Array.from({ length: 120 }, (_, i) => ({ lat: 30 + i * 0.1, lon: -100 }))
    await getForecasts(pts, { fetchImpl, now: 1000, batchSize: 50 })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('serves fresh cache without calling the API', async () => {
    const cache = createMemoryCache()
    const fetchImpl = okFetch()
    await getForecasts([A], { fetchImpl, cache, now: 1000 })
    const again = await getForecasts([A], { fetchImpl, cache, now: 1000 + 60_000 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(again.forecasts.get(pointKey(A))!.stale).toBe(false)
  })

  it('refreshes an expired cache entry', async () => {
    const cache = createMemoryCache()
    const fetchImpl = okFetch()
    await getForecasts([A], { fetchImpl, cache, now: 1000, ttlMs: 10 })
    await getForecasts([A], { fetchImpl, cache, now: 5000, ttlMs: 10 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('falls back to a stale cache when the API is down, and reports missing points', async () => {
    const cache = createMemoryCache()
    await getForecasts([A], { fetchImpl: okFetch(), cache, now: 1000, ttlMs: 10 })
    const down = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch
    const r = await getForecasts([A, B], { fetchImpl: down, cache, now: 9000, ttlMs: 10 })
    expect(r.forecasts.get(pointKey(A))!.stale).toBe(true)
    expect(r.stale).toEqual([pointKey(A)])
    expect(r.missing).toEqual([pointKey(B)])
    expect(r.errors[0]).toMatch(/503/)
  })

  it('retries transient failures before giving up', async () => {
    let calls = 0
    const flaky = vi.fn(async (url: string) => {
      calls++
      if (calls < 2) return new Response('', { status: 500 })
      return (okFetch() as unknown as (u: string) => Promise<Response>)(url)
    }) as unknown as typeof fetch
    const r = await getForecasts([A], { fetchImpl: flaky, now: 1000 })
    expect(calls).toBe(2)
    expect(r.errors).toEqual([])
  })
})
