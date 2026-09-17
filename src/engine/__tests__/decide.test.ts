import { describe, expect, it } from 'vitest'
import { decide, findBetterShipDate, materialsFor, planShipDays, pointsForOrder } from '../decide'
import { midpoint } from '../zip'
import { DEFAULT_SETTINGS } from '../settings'
import type { Order } from '../types'
import { ctx, forecast, forecastMap, ORIGIN, place, TODAY, ZIPS } from './fixtures'

const order = (zip: string, extra: Partial<Order> = {}): Order => ({ id: `#${zip}`, zip, qty: 1, ...extra })

/** Forecast map covering origin, destination and the route midpoint with flat highs. */
function flat(zip: string, originHigh: number, destHigh: number, midHigh = Math.max(originHigh, destHigh)) {
  const dest = place(zip)
  const mid = midpoint(ORIGIN.lat, ORIGIN.lon, dest.lat, dest.lon)
  return forecastMap([
    [ORIGIN, forecast(ORIGIN, originHigh)],
    [dest, forecast(dest, destHigh)],
    [mid, forecast(mid, midHigh)],
  ])
}

describe('tier thresholds', () => {
  it.each([
    [64.9, 'none'],
    [65, 'single'],
    [79.9, 'single'],
    [80, 'double'],
    [101, 'double'],
  ])('worst case %s°F → %s', (high, tier) => {
    const d = decide(order('67206'), ctx({ forecasts: flat('67206', high, high) }))
    expect(d.status).toBe('ok')
    expect(d.tier).toBe(tier)
  })

  it('uses configurable thresholds', () => {
    const c = ctx({ forecasts: flat('67206', 72, 72) })
    c.settings.thresholds = { single: 60, double: 70, hold: 90 }
    expect(decide(order('67206'), c).tier).toBe('double')
  })
})

describe('worst case across the window', () => {
  it('a hot ship day in Wichita drives the tier even when the destination is cool', () => {
    const d = decide(order('80202'), ctx({ forecasts: flat('80202', 99, 60, 60) }))
    expect(d.tier).toBe('double')
    expect(d.worst?.role).toBe('origin')
    expect(d.worst?.place).toBe('Wichita, KS')
    expect(d.reasons[0]).toMatch(/99°F in Wichita, KS/)
  })

  it('a hot destination days later drives the tier even when ship day is cool', () => {
    // Phoenix: 3 ground days from Thursday → delivered Tuesday. Cool everywhere except Phoenix on Tuesday.
    const dest = place('85004')
    const mid = midpoint(ORIGIN.lat, ORIGIN.lon, dest.lat, dest.lon)
    const forecasts = forecastMap([
      [ORIGIN, forecast(ORIGIN, 60)],
      [mid, forecast(mid, 60)],
      [dest, forecast(dest, (i) => (i === 5 ? 96 : 60))], // index 5 = Tue 2026-09-22
    ])
    const d = decide(order('85004'), ctx({ forecasts }))
    expect(d.deliveryDate).toBe('2026-09-22')
    expect(d.worst?.date).toBe('2026-09-22')
    expect(d.worst?.role).toBe('destination')
    expect(d.tier).toBe('double')
  })

  it('the porch day after delivery counts', () => {
    const dest = place('67206') // 1 transit day: ship Thu, deliver Fri, porch Sat
    const forecasts = forecastMap([
      [ORIGIN, forecast(ORIGIN, 60)],
      [midpoint(ORIGIN.lat, ORIGIN.lon, dest.lat, dest.lon), forecast(dest, 60)],
      [dest, forecast(dest, (i) => (i === 2 ? 88 : 60))],
    ])
    const d = decide(order('67206'), ctx({ forecasts }))
    expect(d.worst?.role).toBe('porch')
    expect(d.tier).toBe('double')
    const noPorch = ctx({ forecasts })
    noPorch.settings.porchDays = 0
    expect(decide(order('67206'), noPorch).tier).toBe('none')
  })

  it('the route midpoint counts only when enabled', () => {
    const on = decide(order('85004'), ctx({ forecasts: flat('85004', 60, 60, 95) }))
    expect(on.tier).toBe('double')
    expect(on.worst?.role).toBe('route')
    const c = ctx({ forecasts: flat('85004', 60, 60, 95) })
    c.settings.routeWaypoint = false
    expect(decide(order('85004'), c).tier).toBe('none')
  })
})

describe('materials and cost', () => {
  it('scales ice packs with long transit, capped', () => {
    const s = DEFAULT_SETTINGS
    expect(materialsFor('double', 1, s)).toMatchObject({ liners: 2, icePacks: 2 })
    expect(materialsFor('double', 3, s)).toMatchObject({ liners: 2, icePacks: 3 })
    expect(materialsFor('double', 5, s)).toMatchObject({ liners: 2, icePacks: 4 })
    expect(materialsFor('single', 5, s)).toMatchObject({ liners: 1, icePacks: 0 })
    expect(materialsFor('none', 5, s)).toMatchObject({ liners: 0, icePacks: 0, cost: 0 })
  })
  it('prices from the configured unit costs', () => {
    const s = structuredClone(DEFAULT_SETTINGS)
    s.costs = { liner: 2, icePack: 1 }
    expect(materialsFor('double', 2, s).cost).toBe(6)
  })
})

describe('warnings', () => {
  it('flags a weekend in transit when thermal protection is needed', () => {
    const d = decide(order('85004'), ctx({ forecasts: flat('85004', 70, 70) })) // Thu → Tue
    expect(d.warnings.join(' ')).toMatch(/weekend/)
  })
  it('does not nag about weekends for a no-thermal box', () => {
    const d = decide(order('85004'), ctx({ forecasts: flat('85004', 50, 50) }))
    expect(d.warnings.join(' ')).not.toMatch(/weekend/)
  })
  it('moves a Saturday ship date to Monday and says so', () => {
    const d = decide(order('67206'), ctx({ shipDate: '2026-09-19', forecasts: flat('67206', 60, 60) }))
    expect(d.shipDate).toBe('2026-09-21')
    expect(d.warnings.join(' ')).toMatch(/weekend/)
  })
  it('flags Alaska ground', () => {
    const d = decide(order('99501'), ctx({ forecasts: flat('99501', 60, 50) }))
    expect(d.transitDays).toBe(DEFAULT_SETTINGS.transit.farDays)
    expect(d.warnings.join(' ')).toMatch(/AK/)
  })
  it('keeps the leading-zero fix visible', () => {
    const d = decide(order('2138'), ctx({ forecasts: flat('02138', 60, 60) }))
    expect(d.zip).toBe('02138')
    expect(d.warnings.join(' ')).toMatch(/leading zero/i)
  })
})

describe('when the data is missing', () => {
  it('an unknown zip goes to review at the safest tier', () => {
    const d = decide(order('00000'), ctx())
    expect(d.status).toBe('needs_review')
    expect(d.tier).toBe('double')
    expect(d.warnings[0]).toMatch(/not in the zip table/)
  })
  it('a non-US order goes to review', () => {
    const d = decide(order('M5V 3L9', { country: 'CA' }), ctx())
    expect(d.status).toBe('needs_review')
  })
  it('a zip in a different state than the order claims goes to review', () => {
    // "7870" for Austin, TX: restoring the leading zero gives 07870 — a real New Jersey zip.
    const db = { ...ZIPS, '07870': [40.9, -74.53, 'Rockaway', 'NJ'] as [number, number, string, string] }
    const d = decide(order('7870', { city: 'Austin', state: 'TX' }), ctx({ zipDb: db }))
    expect(d.status).toBe('needs_review')
    expect(d.warnings[0]).toMatch(/07870 is in NJ but the order says TX/)
    const fine = decide(order('85004', { state: 'az' }), ctx({ forecasts: flat('85004', 60, 60) }))
    expect(fine.status).toBe('ok')
  })
  it('no forecast at all → no_forecast, safest tier, no fake temperature', () => {
    const d = decide(order('85004'), ctx({ forecasts: new Map() }))
    expect(d.status).toBe('no_forecast')
    expect(d.worst).toBeNull()
    expect(d.tier).toBe('double')
  })
  it('a partial forecast decides on what it has and drops confidence', () => {
    const dest = place('85004')
    const mid = midpoint(ORIGIN.lat, ORIGIN.lon, dest.lat, dest.lon)
    const forecasts = forecastMap([
      [ORIGIN, forecast(ORIGIN, 70, 60, TODAY, 3)],
      [mid, forecast(mid, 70, 60, TODAY, 3)],
      [dest, forecast(dest, 70, 60, TODAY, 3)],
    ])
    const d = decide(order('85004'), ctx({ forecasts }))
    expect(d.status).toBe('ok')
    expect(d.tier).toBe('single')
    expect(d.confidence).toBe('low')
    expect(d.warnings.join(' ')).toMatch(/No forecast yet/)
  })
})

describe('confidence', () => {
  it('is high within a week and medium beyond', () => {
    expect(decide(order('67206'), ctx({ forecasts: flat('67206', 60, 60) })).confidence).toBe('high')
    const far = decide(order('67206'), ctx({ shipDate: '2026-09-25', forecasts: flat('67206', 60, 60) }))
    expect(far.confidence).toBe('medium')
  })
})

describe('recommendations', () => {
  it('above the hold threshold, offers a faster service and a cooler day', () => {
    const dest = place('85004')
    const mid = midpoint(ORIGIN.lat, ORIGIN.lon, dest.lat, dest.lon)
    // Hot through Sunday, cool from Monday on.
    const curve = (i: number) => (i <= 3 ? 100 : 70)
    const forecasts = forecastMap([
      [ORIGIN, forecast(ORIGIN, curve)],
      [mid, forecast(mid, curve)],
      [dest, forecast(dest, curve)],
    ])
    const d = decide(order('85004'), ctx({ forecasts }))
    expect(d.tier).toBe('double')
    expect(d.recommendation).not.toBeNull()
    expect(d.recommendation!.detail).toMatch(/hold threshold/)
    expect(d.recommendation!.detail).toMatch(/hold until Mon Sep 21/)
    expect(d.recommendation!.holdUntil).toBe('2026-09-21')
  })

  it('recommends expediting a long, hot ground transit', () => {
    const d = decide(order('98101'), ctx({ forecasts: flat('98101', 85, 85) })) // 5 ground days
    expect(d.recommendation?.detail).toMatch(/long time on ice/)
    expect(d.recommendation?.detail).toMatch(/Upgrade to 2-Day/)
  })

  it('stays quiet when the box is simply double-thermal for a short trip', () => {
    const d = decide(order('75201'), ctx({ forecasts: flat('75201', 85, 85) })) // 2 days
    expect(d.recommendation).toBeNull()
  })

  it('findBetterShipDate skips weekends and finds the first cooler weekday', () => {
    const dest = place('67206')
    const mid = midpoint(ORIGIN.lat, ORIGIN.lon, dest.lat, dest.lon)
    const curve = (i: number) => (i <= 5 ? 90 : 60) // cool from Wed Sep 23
    const forecasts = forecastMap([
      [ORIGIN, forecast(ORIGIN, curve)],
      [mid, forecast(mid, curve)],
      [dest, forecast(dest, curve)],
    ])
    const better = findBetterShipDate(order('67206'), ctx({ forecasts }), 'double')
    expect(better?.shipDate).toBe('2026-09-23')
    expect(better?.tier).toBe('none')
  })
})

describe('cold rule', () => {
  it('adds a liner below the cold threshold when enabled', () => {
    const dest = place('67206')
    const mid = midpoint(ORIGIN.lat, ORIGIN.lon, dest.lat, dest.lon)
    const forecasts = forecastMap([
      [ORIGIN, forecast(ORIGIN, 30, 10)],
      [mid, forecast(mid, 30, 10)],
      [dest, forecast(dest, 30, 10)],
    ])
    const off = decide(order('67206'), ctx({ forecasts }))
    expect(off.tier).toBe('none')
    const c = ctx({ forecasts })
    c.settings.coldRule = { enabled: true, below: 20 }
    const on = decide(order('67206'), c)
    expect(on.tier).toBe('single')
    expect(on.reasons.join(' ')).toMatch(/cold protection/)
  })
})

describe('planner and prefetch', () => {
  it('pointsForOrder lists origin, destination and midpoint', () => {
    const pts = pointsForOrder(order('85004'), ctx())
    expect(pts).toHaveLength(3)
    const c = ctx()
    c.settings.routeWaypoint = false
    expect(pointsForOrder(order('85004'), c)).toHaveLength(2)
    expect(pointsForOrder(order('00000'), ctx())).toHaveLength(0)
  })
  it('planShipDays returns one decision per day', () => {
    const plan = planShipDays(order('67206'), ctx({ forecasts: flat('67206', 60, 60) }), 7)
    expect(plan).toHaveLength(7)
    expect(plan[0].shipDate).toBe(TODAY)
    expect(plan.every((p) => p.decision.recommendation === null)).toBe(true)
  })
})
