import { describe, expect, it } from 'vitest'
import { parseCsv, parseInput, parseList } from '../import'
import { toCsv } from '../export'
import { effectiveTier, lineMaterials, sortForBench, summarize, type PackLine } from '../packlist'
import { decide } from '../decide'
import { DEFAULT_SETTINGS } from '../settings'
import { ctx, forecast, forecastMap, ORIGIN, place } from './fixtures'
import { midpoint } from '../zip'

const SHOPIFY = `Name,Email,Financial Status,Paid at,Fulfillment Status,Fulfilled at,Currency,Subtotal,Shipping,Taxes,Total,Discount Code,Discount Amount,Shipping Method,Created at,Lineitem quantity,Lineitem name,Lineitem price,Lineitem sku,Shipping Name,Shipping Street,Shipping City,Shipping Zip,Shipping Province,Shipping Country
#1041,a@example.com,paid,2026-09-16 09:12:00 -0500,unfulfilled,,USD,48.00,9.00,3.50,60.50,,,UPS Ground,2026-09-16 09:12:00 -0500,1,Signature Truffle Box (12),48.00,TRF-12,Maria Lopez,1 Main St,Phoenix,'85004,AZ,US
#1041,,,,,,,,,,,,,,,2,Sea Salt Caramels (6),18.00,CAR-6,,,,,,
#1042,b@example.com,paid,2026-09-16 10:00:00 -0500,fulfilled,2026-09-16 15:00:00 -0500,USD,30.00,0.00,2.00,32.00,,,Standard,2026-09-16 10:00:00 -0500,1,Dark Bar Trio,30.00,BAR-3,Sam Chen,2 Elm St,Miami,'33101,FL,US
#1043,c@example.com,paid,2026-09-16 11:30:00 -0500,unfulfilled,,USD,96.00,0.00,0.00,96.00,,,UPS 2nd Day Air,2026-09-16 11:30:00 -0500,2,Signature Truffle Box (12),48.00,TRF-12,Priya Nair,3 Oak Ave,Cambridge,'02138,MA,US
#1044,d@example.com,paid,2026-09-16 12:00:00 -0500,unfulfilled,,USD,20.00,15.00,0.00,35.00,,,International,2026-09-16 12:00:00 -0500,1,Dark Bar Trio,20.00,BAR-3,Liam Ng,4 King St,Toronto,M5V 3L9,ON,CA
`

describe('Shopify export', () => {
  it('groups line items into orders and keeps the shipping fields', () => {
    const r = parseCsv(SHOPIFY)
    expect(r.source).toBe('shopify')
    const o = r.orders.find((x) => x.id === '#1041')!
    expect(o.qty).toBe(3)
    expect(o.lineItems).toEqual(['Signature Truffle Box (12)', 'Sea Salt Caramels (6)'])
    expect(o.zip).toBe("'85004")
    expect(o.customer).toBe('Maria Lopez')
    expect(o.state).toBe('AZ')
    expect(o.serviceLevel).toBe('ground')
  })
  it('skips fulfilled orders by default and counts them', () => {
    const r = parseCsv(SHOPIFY)
    expect(r.orders.map((o) => o.id)).toEqual(['#1041', '#1043', '#1044'])
    expect(r.skipped.fulfilled).toBe(1)
    const all = parseCsv(SHOPIFY, { includeFulfilled: true })
    expect(all.orders).toHaveLength(4)
  })
  it('reads the service level from the shipping method', () => {
    const r = parseCsv(SHOPIFY)
    expect(r.orders.find((o) => o.id === '#1043')!.serviceLevel).toBe('two_day')
  })
  it('keeps a non-US order so the engine can flag it', () => {
    const r = parseCsv(SHOPIFY)
    expect(r.orders.find((o) => o.id === '#1044')!.country).toBe('CA')
  })
})

describe('generic CSV', () => {
  it('finds a zip column by name and optional id / qty / method columns', () => {
    const r = parseCsv('Order,Postal Code,Qty,Service\nA1,80202,2,FedEx 2Day\nA2,33101,,\n')
    expect(r.source).toBe('csv')
    expect(r.orders).toEqual([
      expect.objectContaining({ id: 'A1', zip: '80202', qty: 2, serviceLevel: 'two_day' }),
      expect.objectContaining({ id: 'A2', zip: '33101', qty: 1 }),
    ])
  })
  it('explains when there is no zip column', () => {
    expect(() => parseCsv('a,b\n1,2\n')).toThrow(/No zip column/)
  })
})

describe('pasted list', () => {
  it('reads zips with optional ids, quantities and service', () => {
    const r = parseList('85004\n#1050 33101 x2\n02138, 3\n98101 2-Day\n\nnot a zip\n')
    expect(r.orders).toEqual([
      expect.objectContaining({ id: 'Zip 1', zip: '85004', qty: 1 }),
      expect.objectContaining({ id: '#1050', zip: '33101', qty: 2 }),
      expect.objectContaining({ id: 'Zip 3', zip: '02138', qty: 3 }),
      expect.objectContaining({ id: 'Zip 4', zip: '98101', serviceLevel: 'two_day' }),
    ])
  })
  it('parseInput routes CSV text to the CSV parser and lists to the list parser', () => {
    expect(parseInput('zip,qty\n85004,1\n').source).toBe('csv')
    expect(parseInput('85004\n33101\n').source).toBe('list')
  })
})

describe('pack list', () => {
  const dest = place('85004')
  const mid = midpoint(ORIGIN.lat, ORIGIN.lon, dest.lat, dest.lon)
  const forecasts = forecastMap([
    [ORIGIN, forecast(ORIGIN, 85)],
    [mid, forecast(mid, 85)],
    [dest, forecast(dest, 85)],
  ])
  const c = ctx({ forecasts })
  const order = { id: '#1', zip: '85004', qty: 1 }
  const line: PackLine = { order, decision: decide(order, c) }
  const review: PackLine = { order: { id: '#9', zip: '00000', qty: 1 }, decision: decide({ id: '#9', zip: '00000', qty: 1 }, c) }

  it('an override changes the tier and the materials', () => {
    expect(effectiveTier(line)).toBe('double')
    expect(lineMaterials(line, c.settings).icePacks).toBe(3)
    const over: PackLine = { ...line, override: { tier: 'single', note: 'customer picking up same day' } }
    expect(effectiveTier(over)).toBe('single')
    expect(lineMaterials(over, c.settings)).toEqual({ liners: 1, icePacks: 0, cost: 1.85 })
  })

  it('summarize totals liners, ice packs and cost', () => {
    const over: PackLine = { ...line, order: { ...order, id: '#2' }, override: { tier: 'single', note: '' } }
    const s = summarize([line, over], c.settings)
    expect(s.orders).toBe(2)
    expect(s.byTier).toEqual({ none: 0, single: 1, double: 1 })
    expect(summarize([line, review], c.settings).byTier.double).toBe(1)
    expect(s.liners).toBe(3)
    expect(s.icePacks).toBe(3)
    expect(s.overrides).toBe(1)
    expect(s.cost).toBeCloseTo(2 * 1.85 + 3 * 0.95 + 1.85, 2)
  })

  it('sortForBench puts review items first, then hottest tiers', () => {
    const cool = { id: '#3', zip: '67206', qty: 1 }
    const coolLine: PackLine = { order: cool, decision: decide(cool, ctx({ forecasts: forecastMap([[ORIGIN, forecast(ORIGIN, 50)], [place('67206'), forecast(place('67206'), 50)]]) })) }
    const sorted = sortForBench([coolLine, line, review])
    expect(sorted.map((l) => l.order.id)).toEqual(['#9', '#1', '#3'])
  })

  it('exports CSV with quoting and override-aware materials', () => {
    const over: PackLine = { ...line, override: { tier: 'single', note: 'Note, with "quotes"' } }
    const csv = toCsv([over], DEFAULT_SETTINGS)
    const [header, row] = csv.split('\r\n')
    expect(header.split(',')).toContain('Ice packs')
    expect(row).toContain('Single thermal')
    expect(row).toContain('"Note, with ""quotes"""')
    expect(row).toContain(',1,0,1.85,')
  })
})
