// Turns what the shipping team has on hand — a Shopify order export or any
// CSV with a zip column — into Orders.

import Papa from 'papaparse'
import { parseServiceLevel } from './transit'
import type { Order } from './types'

export interface ImportResult {
  orders: Order[]
  /** Which parser handled the input. */
  source: 'shopify' | 'csv'
  skipped: { fulfilled: number; noZip: number }
  columns: string[]
}

type Row = Record<string, string>

function pick(row: Row, ...names: string[]): string {
  for (const n of names) {
    const v = row[n]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

function findColumn(columns: string[], pattern: RegExp): string | undefined {
  return columns.find((c) => pattern.test(c))
}

const isShopify = (columns: string[]) => columns.includes('Name') && columns.includes('Shipping Zip') && columns.includes('Lineitem quantity')

/**
 * Shopify exports one row per line item; order-level columns are filled only
 * on the first row of each order. Rows are grouped by the order `Name`.
 */
function parseShopify(rows: Row[], includeFulfilled: boolean): Omit<ImportResult, 'columns'> {
  const byName = new Map<string, Order>()
  const skipped = { fulfilled: 0, noZip: 0 }
  for (const row of rows) {
    const name = pick(row, 'Name')
    if (!name) continue
    const qty = Number(pick(row, 'Lineitem quantity')) || 0
    const item = pick(row, 'Lineitem name')
    const existing = byName.get(name)
    if (existing) {
      existing.qty += qty
      if (item) existing.lineItems!.push(item)
      // Later rows can carry the shipping fields when the first row is a note line.
      if (!existing.zip) existing.zip = pick(row, 'Shipping Zip')
      continue
    }
    const shippingMethod = pick(row, 'Shipping Method')
    const fulfillment = pick(row, 'Fulfillment Status').toLowerCase()
    byName.set(name, {
      id: name,
      zip: pick(row, 'Shipping Zip'),
      qty,
      customer: pick(row, 'Shipping Name', 'Billing Name'),
      address: pick(row, 'Shipping Address1', 'Shipping Street'),
      city: pick(row, 'Shipping City'),
      state: pick(row, 'Shipping Province'),
      country: pick(row, 'Shipping Country'),
      shippingMethod,
      serviceLevel: parseServiceLevel(shippingMethod),
      lineItems: item ? [item] : [],
      fulfilled: fulfillment === 'fulfilled',
    })
  }
  const orders: Order[] = []
  for (const o of byName.values()) {
    if (o.fulfilled && !includeFulfilled) {
      skipped.fulfilled++
      continue
    }
    if (!o.zip) {
      skipped.noZip++
      // Keep it: the decision engine flags it for review rather than silently dropping an order.
    }
    orders.push(o)
  }
  return { orders, source: 'shopify', skipped }
}

function parseGenericCsv(rows: Row[], columns: string[]): Omit<ImportResult, 'columns'> {
  const zipCol = findColumn(columns, /zip|postal/i)
  if (!zipCol) throw new Error(`No zip column found. Columns: ${columns.join(', ')}`)
  const idCol = findColumn(columns, /^(order|order ?(id|#|number|name)|name|id)$/i)
  const qtyCol = findColumn(columns, /qty|quantity|pieces|items/i)
  const methodCol = findColumn(columns, /shipping ?method|service|carrier/i)
  const cityCol = findColumn(columns, /city/i)
  const stateCol = findColumn(columns, /state|province/i)
  const customerCol = findColumn(columns, /customer|shipping name|recipient/i)
  const orders: Order[] = rows
    .filter((r) => pick(r, zipCol) !== '' || (idCol && pick(r, idCol) !== ''))
    .map((r, i) => {
      const method = methodCol ? pick(r, methodCol) : ''
      return {
        id: idCol ? pick(r, idCol) || `Row ${i + 1}` : `Row ${i + 1}`,
        zip: pick(r, zipCol),
        qty: qtyCol ? Number(pick(r, qtyCol)) || 1 : 1,
        city: cityCol ? pick(r, cityCol) : undefined,
        state: stateCol ? pick(r, stateCol) : undefined,
        customer: customerCol ? pick(r, customerCol) : undefined,
        shippingMethod: method || undefined,
        serviceLevel: parseServiceLevel(method),
      }
    })
  return { orders, source: 'csv', skipped: { fulfilled: 0, noZip: orders.filter((o) => !o.zip).length } }
}

export function parseCsv(text: string, options: { includeFulfilled?: boolean } = {}): ImportResult {
  const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() })
  const columns = (parsed.meta.fields ?? []).filter(Boolean)
  const rows = parsed.data
  if (rows.length === 0) throw new Error('The file has no rows.')
  const result = isShopify(columns) ? parseShopify(rows, options.includeFulfilled ?? false) : parseGenericCsv(rows, columns)
  return { ...result, columns }
}

