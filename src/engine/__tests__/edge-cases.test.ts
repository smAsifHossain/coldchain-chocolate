import { describe, expect, it, vi } from 'vitest'
import { carrierHolidays, isCarrierHoliday } from '../dates'
import { deliveryDate, effectiveShipDate, estimateTransitDays, parseServiceLevel } from '../transit'
import { decide, thresholdsForOrder } from '../decide'
import { DEFAULT_SETTINGS } from '../settings'
import { boxesFor, lineMaterials, summarize, tierOverridden, type PackLine } from '../packlist'
import { createMemoryCache, getForecasts, pointKey } from '../weather'
import { midpoint } from '../zip'
import type { Order } from '../types'
import { ctx, forecast, forecastMap, ORIGIN, place } from './fixtures'

const order = (zip: string, extra: Partial<Order> = {}): Order => ({ id: `#${zip}`, zip, qty: 1, ...extra })

function flat(zip: string, high: number) {
  const dest = place(zip)
  const mid = midpoint(ORIGIN.lat, ORIGIN.lon, dest.lat, dest.lon)
  return forecastMap([
    [ORIGIN, forecast(ORIGIN, high)],
    [dest, forecast(dest, high)],
    [mid, forecast(mid, high)],
  ])
}

describe('carrier holidays', () => {
  it('knows the six 2026 dates, with weekend observance', () => {
    const h = carrierHolidays(2026)
    expect([...h].sort()).toEqual(['2026-01-01', '2026-05-25', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25'])
    // July 4 2026 is a Saturday → observed Friday July 3.
    expect(isCarrierHoliday('2026-07-03')).toBe(true)
    expect(isCarrierHoliday('2026-07-04')).toBe(false)
  })
  it('a holiday ship date rolls forward and says it was a holiday', () => {
    expect(effectiveShipDate('2026-09-07')).toMatchObject({ date: '2026-09-08', shifted: true, holiday: true })
    expect(effectiveShipDate('2026-09-07', false)).toMatchObject({ date: '2026-09-07', shifted: false })
  })
  it('a holiday in transit does not count as a moving day', () => {
    // Wed Nov 25 2026 + 2 ground days: Thu 26 is Thanksgiving → Fri 27, Mon 30.
    expect(deliveryDate('2026-11-25', 2, false)).toBe('2026-11-30')
    expect(deliveryDate('2026-11-25', 2, false, false)).toBe('2026-11-27')
  })
  it('the decision explains a holiday inside the window', () => {
    const c = ctx({ shipDate: '2026-11-25', today: '2026-11-25', forecasts: flat('64108', 50) })
    c.forecasts = forecastMap([
      [ORIGIN, forecast(ORIGIN, 50, 40, '2026-11-25')],
      [place('64108'), forecast(place('64108'), 50, 40, '2026-11-25')],
      [midpoint(ORIGIN.lat, ORIGIN.lon, place('64108').lat, place('64108').lon), forecast(ORIGIN, 50, 40, '2026-11-25')],
    ])
    const d = decide(order('64108'), c)
    expect(d.deliveryDate).toBe('2026-11-30')
    expect(d.warnings.join(' ')).toMatch(/Thu Nov 26 is a carrier holiday/)
  })
})

describe('store pickup', () => {
  it('is recognized from the shipping method', () => {
    expect(parseServiceLevel('Pickup in store')).toBe('pickup')
    expect(parseServiceLevel('Local pick-up')).toBe('pickup')
    expect(parseServiceLevel('Click & Collect')).toBe('pickup')
    expect(estimateTransitDays(0, 'KS', 'pickup', DEFAULT_SETTINGS).days).toBe(0)
  })
  it('is judged on the origin high the day it is collected, no transit, no porch', () => {
    const dest = place('67206')
    const forecasts = forecastMap([
      [ORIGIN, forecast(ORIGIN, (i) => (i === 0 ? 70 : 100))],
      [dest, forecast(dest, 100)],
    ])
    const d = decide(order('67206', { shippingMethod: 'Pickup in store' }), ctx({ forecasts }))
    expect(d.serviceLevel).toBe('pickup')
    expect(d.transitDays).toBe(0)
    expect(d.deliveryDate).toBe(d.shipDate)
    expect(d.window).toHaveLength(1)
    expect(d.window[0].place).toBe('Wichita, KS')
    expect(d.tier).toBe('single')
    expect(d.reasons.join(' ')).toMatch(/Store pickup/)
    expect(d.recommendation).toBeNull()
  })
  it('a weekend pickup stays on the weekend', () => {
    const d = decide(order('67206', { serviceLevel: 'pickup' }), ctx({ shipDate: '2026-09-19', forecasts: flat('67206', 60) }))
    expect(d.shipDate).toBe('2026-09-19')
  })
})

describe('military addresses', () => {
  it('are flagged like Alaska, with a USPS note', () => {
    const db = { ...ctx().zipDb, '09001': [50.0, 8.0, 'APO', 'AE'] as [number, number, string, string] }
    const d = decide(order('09001', { state: 'AE' }), ctx({ zipDb: db, forecasts: flat('67206', 60) }))
    expect(d.transitDays).toBe(DEFAULT_SETTINGS.transit.farDays)
    expect(d.warnings.join(' ')).toMatch(/Military address/)
  })
})

describe('product rules', () => {
  it('lower the thresholds for cream centers and pick the most sensitive rule', () => {
    const o = order('67206', { lineItems: ['Milk Chocolate Toffee', 'Sea Salt Caramels (6)'] })
    const { thresholds, rule } = thresholdsForOrder(o, DEFAULT_SETTINGS)
    expect(rule?.offset).toBe(-5)
    expect(thresholds).toEqual({ single: 60, double: 75, hold: 90 })
    expect(thresholdsForOrder(order('67206', { lineItems: ['Dark Chocolate Bar Trio'] }), DEFAULT_SETTINGS).rule).toBeNull()
    expect(thresholdsForOrder(order('67206'), DEFAULT_SETTINGS).rule).toBeNull()
  })
  it('change the decision and say so', () => {
    const bars = decide(order('67206', { lineItems: ['Dark Chocolate Bar Trio'] }), ctx({ forecasts: flat('67206', 77) }))
    const truffles = decide(order('67206', { lineItems: ['Signature Truffle Collection'] }), ctx({ forecasts: flat('67206', 77) }))
    expect(bars.tier).toBe('single')
    expect(truffles.tier).toBe('double')
    expect(truffles.thresholds.double).toBe(75)
    expect(truffles.reasons.join(' ')).toMatch(/thresholds lowered 5°F/)
  })
  it('ignore a broken pattern instead of crashing', () => {
    const s = structuredClone(DEFAULT_SETTINGS)
    s.productRules = [{ label: 'bad', pattern: '(', offset: -5 }]
    expect(thresholdsForOrder(order('67206', { lineItems: ['Truffles'] }), s).rule).toBeNull()
  })
})

describe('boxes per order', () => {
  const c = ctx({ forecasts: flat('85004', 85) })
  const o = order('85004')
  const line: PackLine = { order: o, decision: decide(o, c) }
  it('multiply liners, ice packs and cost', () => {
    expect(boxesFor(line)).toBe(1)
    const five: PackLine = { ...line, override: { boxes: 5 } }
    expect(boxesFor(five)).toBe(5)
    expect(lineMaterials(five, c.settings)).toEqual({ liners: 10, icePacks: 15, cost: 5 * (2 * 1.85 + 3 * 0.95) })
    expect(tierOverridden(five)).toBe(false)
    expect(summarize([five], c.settings).boxes).toBe(5)
  })
  it('a box count alone is not a tier override', () => {
    expect(summarize([{ ...line, override: { boxes: 2, note: 'two boxes' } }], c.settings).overrides).toBe(0)
    expect(summarize([{ ...line, override: { tier: 'single' } }], c.settings).overrides).toBe(1)
  })
})

describe('NWS fallback', () => {
  const A = { lat: 37.69, lon: -97.34 }
  const nwsFetch = (meteoStatus: number) =>
    vi.fn(async (url: string) => {
      if (url.startsWith('https://api.open-meteo.com')) return new Response('', { status: meteoStatus })
      if (url.includes('/points/')) return new Response(JSON.stringify({ properties: { forecast: 'https://api.weather.gov/gridpoints/ICT/62,34/forecast' } }), { status: 200 })
      if (url.includes('/gridpoints/')) {
        const periods = [
          { startTime: '2026-09-17T18:00:00-05:00', isDaytime: false, temperature: 76, temperatureUnit: 'F' },
          { startTime: '2026-09-18T06:00:00-05:00', isDaytime: true, temperature: 96, temperatureUnit: 'F' },
          { startTime: '2026-09-18T18:00:00-05:00', isDaytime: false, temperature: 75, temperatureUnit: 'F' },
          { startTime: '2026-09-19T06:00:00-05:00', isDaytime: true, temperature: 30, temperatureUnit: 'C' },
        ]
        return new Response(JSON.stringify({ properties: { periods } }), { status: 200 })
      }
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch

  it('fills in from the National Weather Service when Open-Meteo is down', async () => {
    const r = await getForecasts([A], { fetchImpl: nwsFetch(503), now: 1000 })
    const fc = r.forecasts.get(pointKey(A))!
    expect(fc.source).toBe('nws')
    expect(r.fallback).toEqual([pointKey(A)])
    expect(r.missing).toEqual([])
    expect(fc.days).toEqual([
      { date: '2026-09-18', high: 96, low: 75 },
      { date: '2026-09-19', high: 86, low: 71 },
    ])
  })

  it('still falls back to the cache when both providers fail', async () => {
    const cache = createMemoryCache()
    const okMeteo = vi.fn(async () =>
      new Response(JSON.stringify({ latitude: A.lat, longitude: A.lon, daily: { time: ['2026-09-17'], temperature_2m_max: [90], temperature_2m_min: [70] } }), { status: 200 }),
    ) as unknown as typeof fetch
    await getForecasts([A], { fetchImpl: okMeteo, cache, now: 1000, ttlMs: 10 })
    const allDown = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch
    const r = await getForecasts([A], { fetchImpl: allDown, cache, now: 9000, ttlMs: 10 })
    expect(r.forecasts.get(pointKey(A))!.stale).toBe(true)
    expect(r.fallback).toEqual([])
    expect(r.errors.some((e) => e.startsWith('NWS:'))).toBe(true)
  })
})
