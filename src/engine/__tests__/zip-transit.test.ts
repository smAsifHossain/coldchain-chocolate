import { describe, expect, it } from 'vitest'
import { haversineMiles, midpoint, normalizeZip } from '../zip'
import {
  deliveryDate,
  effectiveShipDate,
  estimateTransitDays,
  inTransitDates,
  parseServiceLevel,
  spansWeekend,
} from '../transit'
import { DEFAULT_SETTINGS } from '../settings'
import { ORIGIN, place } from './fixtures'

describe('normalizeZip', () => {
  it('accepts a plain 5-digit zip', () => {
    expect(normalizeZip('85004')).toEqual({ zip: '85004', note: null })
  })
  it('strips ZIP+4', () => {
    expect(normalizeZip('85004-1234').zip).toBe('85004')
    expect(normalizeZip('85004 1234').zip).toBe('85004')
    expect(normalizeZip('850041234').zip).toBe('85004')
  })
  it("strips Shopify's leading apostrophe", () => {
    expect(normalizeZip("'02138").zip).toBe('02138')
  })
  it('restores leading zeros Excel drops, and says so', () => {
    const r = normalizeZip(2138)
    expect(r.zip).toBe('02138')
    expect(r.note).toMatch(/leading zero/i)
    expect(normalizeZip('501').zip).toBe('00501')
  })
  it('rejects garbage with a readable note', () => {
    expect(normalizeZip('SW1A 1AA').zip).toBeNull()
    expect(normalizeZip('').note).toMatch(/missing/i)
    expect(normalizeZip(null).zip).toBeNull()
    expect(normalizeZip('12').zip).toBeNull()
  })
})

describe('distance', () => {
  it('Wichita → Phoenix is roughly 890 miles', () => {
    const p = place('85004')
    const mi = haversineMiles(ORIGIN.lat, ORIGIN.lon, p.lat, p.lon)
    expect(mi).toBeGreaterThan(850)
    expect(mi).toBeLessThan(930)
  })
  it('midpoint lies between the endpoints', () => {
    const p = place('33101')
    const m = midpoint(ORIGIN.lat, ORIGIN.lon, p.lat, p.lon)
    expect(m.lat).toBeLessThan(ORIGIN.lat)
    expect(m.lat).toBeGreaterThan(p.lat)
    expect(m.lon).toBeGreaterThan(ORIGIN.lon)
    expect(m.lon).toBeLessThan(p.lon)
  })
})

describe('parseServiceLevel', () => {
  it('maps Shopify shipping method text', () => {
    expect(parseServiceLevel('UPS Ground')).toBe('ground')
    expect(parseServiceLevel('Standard Shipping')).toBe('ground')
    expect(parseServiceLevel('UPS 2nd Day Air')).toBe('two_day')
    expect(parseServiceLevel('FedEx 2Day')).toBe('two_day')
    expect(parseServiceLevel('Priority Mail Express')).toBe('two_day')
    expect(parseServiceLevel('UPS Next Day Air')).toBe('overnight')
    expect(parseServiceLevel('FedEx Priority Overnight')).toBe('overnight')
    expect(parseServiceLevel(undefined)).toBe('ground')
  })
})

describe('estimateTransitDays', () => {
  const s = DEFAULT_SETTINGS
  it('uses distance zones for ground', () => {
    expect(estimateTransitDays(20, 'KS', 'ground', s).days).toBe(1)
    expect(estimateTransitDays(200, 'MO', 'ground', s).days).toBe(2)
    expect(estimateTransitDays(890, 'AZ', 'ground', s).days).toBe(3)
    expect(estimateTransitDays(1300, 'FL', 'ground', s).days).toBe(4)
    expect(estimateTransitDays(1700, 'WA', 'ground', s).days).toBe(5)
  })
  it('service level overrides distance', () => {
    expect(estimateTransitDays(1700, 'WA', 'two_day', s).days).toBe(2)
    expect(estimateTransitDays(1700, 'WA', 'overnight', s).days).toBe(1)
  })
  it('Alaska and Hawaii get the longest ground estimate and a flag', () => {
    const r = estimateTransitDays(3000, 'AK', 'ground', s)
    expect(r.days).toBe(s.transit.farDays)
    expect(r.nonContiguous).toBe(true)
  })
  it('unknown distance assumes the longest transit', () => {
    expect(estimateTransitDays(null, undefined, 'ground', s).days).toBe(s.transit.farDays)
  })
})

describe('calendar math', () => {
  it('weekend ship dates move to Monday', () => {
    expect(effectiveShipDate('2026-09-19')).toMatchObject({ date: '2026-09-21', shifted: true }) // Sat
    expect(effectiveShipDate('2026-09-20')).toMatchObject({ date: '2026-09-21', shifted: true }) // Sun
    expect(effectiveShipDate('2026-09-21')).toMatchObject({ date: '2026-09-21', shifted: false })
  })
  it('Thursday + 3 ground days skips the weekend → Tuesday', () => {
    expect(deliveryDate('2026-09-17', 3, false)).toBe('2026-09-22')
  })
  it('Thursday + 1 day → Friday; + 2 days → Monday without Saturday delivery', () => {
    expect(deliveryDate('2026-09-17', 1, false)).toBe('2026-09-18')
    expect(deliveryDate('2026-09-17', 2, false)).toBe('2026-09-21')
  })
  it('Saturday delivery counts Saturday as a transit day', () => {
    expect(deliveryDate('2026-09-17', 2, true)).toBe('2026-09-19')
  })
  it('in-transit dates exclude ship and delivery days', () => {
    expect(inTransitDates('2026-09-17', '2026-09-22')).toEqual(['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'])
    expect(inTransitDates('2026-09-17', '2026-09-18')).toEqual([])
  })
  it('spansWeekend needs both Saturday and Sunday in transit', () => {
    expect(spansWeekend('2026-09-17', '2026-09-22')).toBe(true)
    expect(spansWeekend('2026-09-17', '2026-09-18')).toBe(false)
    expect(spansWeekend('2026-09-21', '2026-09-24')).toBe(false)
  })
})
