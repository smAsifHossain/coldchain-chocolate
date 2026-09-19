import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCsv } from '../import'
import { resolveOrder } from '../decide'
import type { ZipDb } from '../zip'

const zipDb = JSON.parse(readFileSync('public/data/zips.json', 'utf8')) as ZipDb

/** The files a judge or the team may upload must import clean and locate every order. */
describe.each([
  ['public/sample-orders.csv', 16],
  ['samples/shopify-orders-50.csv', 50],
])('%s', (file, expected) => {
  const result = parseCsv(readFileSync(file, 'utf8'), { includeFulfilled: true })

  it(`is recognized as a Shopify export with ${expected} orders`, () => {
    expect(result.source).toBe('shopify')
    expect(result.orders).toHaveLength(expected)
    expect(new Set(result.orders.map((o) => o.id)).size).toBe(expected)
  })

  it('locates every order in the zip table with a matching state', () => {
    const bad = result.orders.map((o) => [o.id, resolveOrder(o, zipDb)] as const).filter(([, r]) => !r.place)
    expect(bad.map(([id, r]) => `${id}: ${r.note}`)).toEqual([])
  })

  it('carries a shipping method and at least one line item on every order', () => {
    for (const o of result.orders) {
      expect(o.shippingMethod, o.id).toBeTruthy()
      expect(o.lineItems?.length, o.id).toBeGreaterThan(0)
      expect(o.qty, o.id).toBeGreaterThan(0)
    }
  })
})
