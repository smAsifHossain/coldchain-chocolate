/**
 * Impact analysis. Runs the real decision engine over the 50-order sample
 * against real recorded weather from the Open-Meteo archive, and compares it
 * with the shortcuts a busy person actually takes.
 *
 *   npm run impact
 *
 * Nothing here is estimated or assumed. Every temperature is a measured daily
 * high from the archive, every decision comes from src/engine, and the whole
 * run is reproducible by anyone with the repository.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { parseCsv } from '../src/engine/import'
import { decide, resolveOrder, TIER_RANK, materialsFor } from '../src/engine/decide'
import { DEFAULT_SETTINGS } from '../src/engine/settings'
import { lookupZip, midpoint, type Place, type ZipDb } from '../src/engine/zip'
import { addDays } from '../src/engine/dates'
import { pointKey, type ForecastMap, type GeoPoint } from '../src/engine/weather'
import type { DecideContext, Decision, LocationForecast, Order, Tier } from '../src/engine/types'

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'

/** Real days from 2026, spread across the year so the numbers are not cherry-picked. */
const SHIP_DATES = [
  { date: '2026-01-14', label: 'January, deep winter' },
  { date: '2026-04-15', label: 'April, shoulder season' },
  { date: '2026-06-17', label: 'June, early summer' },
  { date: '2026-07-15', label: 'July, peak summer' },
  { date: '2026-08-19', label: 'August, late summer' },
  { date: '2026-09-16', label: 'September, the week of the build' },
  { date: '2026-10-14', label: 'October, cooling off' },
]

const WINDOW_BEFORE = 1
const WINDOW_AFTER = 12

interface ArchiveDaily {
  daily?: { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[] }
}

const CACHE_DIR = 'scripts/.cache'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The archive weights a request by locations times days, so this asks in small
 * batches, backs off on 429, and caches the answer. The first run takes a
 * couple of minutes; later runs read the cache and are instant.
 */
async function fetchArchive(points: GeoPoint[], start: string, end: string): Promise<ForecastMap> {
  mkdirSync(CACHE_DIR, { recursive: true })
  const cacheFile = `${CACHE_DIR}/archive-${start}-${end}-${points.length}.json`
  if (existsSync(cacheFile)) {
    const raw = JSON.parse(readFileSync(cacheFile, 'utf8')) as [string, LocationForecast][]
    return new Map(raw)
  }
  const out: ForecastMap = new Map()
  for (let i = 0; i < points.length; i += 20) {
    const batch = points.slice(i, i + 20)
    const params = new URLSearchParams({
      latitude: batch.map((p) => p.lat.toFixed(2)).join(','),
      longitude: batch.map((p) => p.lon.toFixed(2)).join(','),
      start_date: start,
      end_date: end,
      daily: 'temperature_2m_max,temperature_2m_min',
      temperature_unit: 'fahrenheit',
      timezone: 'auto',
    })
    let res = await fetch(`${ARCHIVE}?${params}`)
    for (let attempt = 0; attempt < 6 && (res.status === 429 || res.status >= 500); attempt++) {
      await sleep(5_000 * (attempt + 1))
      res = await fetch(`${ARCHIVE}?${params}`)
    }
    if (!res.ok) throw new Error(`archive responded ${res.status}`)
    const body = (await res.json()) as ArchiveDaily | ArchiveDaily[]
    const list = Array.isArray(body) ? body : [body]
    batch.forEach((p, idx) => {
      const d = list[idx]?.daily
      const days: LocationForecast['days'] = []
      if (d) {
        for (let k = 0; k < d.time.length; k++) {
          const high = d.temperature_2m_max[k]
          const low = d.temperature_2m_min[k]
          if (high === null || low === null) continue
          days.push({ date: d.time[k], high, low })
        }
      }
      out.set(pointKey(p), { lat: p.lat, lon: p.lon, days, fetchedAt: Date.now(), stale: false, source: 'open-meteo' })
    })
    await sleep(1_500)
  }
  writeFileSync(cacheFile, JSON.stringify([...out.entries()]))
  return out
}

function tierFromHigh(high: number, t: { single: number; double: number }): Tier {
  if (high >= t.double) return 'double'
  if (high >= t.single) return 'single'
  return 'none'
}

/** The high at one place on one day, from the fetched archive. */
function highAt(forecasts: ForecastMap, p: Place | GeoPoint, date: string): number | null {
  return forecasts.get(pointKey(p))?.days.find((d) => d.date === date)?.high ?? null
}

interface DayResult {
  date: string
  label: string
  orders: number
  byTier: Record<Tier, number>
  /** Orders a shortcut would have packed with less protection than the full window calls for. */
  underByOriginToday: number
  underByDestToday: number
  underByDestDelivery: number
  /** Orders whose hottest day is not the ship day. */
  worstNotShipDay: number
  /** Packaging if every box were double thermal, against what the engine asks for. */
  costDouble: number
  costEngine: number
  linersSaved: number
  icePacksSaved: number
  /** Order value carried by the orders a destination-today check would under-pack. */
  valueUnderpacked: number
  decideMs: number
}

describe('impact', () => {
  it('compares the full window with the shortcuts, on real recorded weather', async () => {
      const zipDb = JSON.parse(readFileSync('public/data/zips.json', 'utf8')) as ZipDb
      const orders: Order[] = parseCsv(readFileSync('samples/shopify-orders-50.csv', 'utf8'), { includeFulfilled: false }).orders
      const origin = lookupZip(zipDb, DEFAULT_SETTINGS.originZip)!

      // Order totals, straight from the export, so "value at risk" is a sum and not an estimate.
      const csv = readFileSync('samples/shopify-orders-50.csv', 'utf8').split('\n')
      const head = csv[0].split(',')
      const nameCol = head.indexOf('Name')
      const totalCol = head.indexOf('Total')
      const orderValue = new Map<string, number>()
      for (const row of csv.slice(1)) {
        const c = row.split(',')
        const v = Number(c[totalCol])
        if (c[nameCol] && Number.isFinite(v) && v > 0) orderValue.set(c[nameCol], v)
      }
      const settings = DEFAULT_SETTINGS

      // Every point the engine will ask about, fetched once for the whole year.
      const points = new Map<string, GeoPoint>()
      points.set(pointKey(origin), origin)
      const destOf = new Map<string, Place>()
      for (const o of orders) {
        const p = resolveOrder(o, zipDb).place
        if (!p) continue
        destOf.set(o.id, p)
        points.set(pointKey(p), p)
        const mid = midpoint(origin.lat, origin.lon, p.lat, p.lon)
        points.set(pointKey(mid), mid)
      }

      const pts = [...points.values()]
      const forecasts: ForecastMap = new Map()
      for (const { date } of SHIP_DATES) {
        const part = await fetchArchive(pts, addDays(date, -WINDOW_BEFORE), addDays(date, WINDOW_AFTER))
        for (const [k, v] of part) {
          const existing = forecasts.get(k)
          if (existing) existing.days.push(...v.days)
          else forecasts.set(k, { ...v, days: [...v.days] })
        }
      }

      const results: DayResult[] = []
      for (const { date, label } of SHIP_DATES) {
        const ctx: DecideContext = { settings, shipDate: date, today: date, origin, zipDb, forecasts }
        const t0 = performance.now()
        const decisions = orders.map((o) => decide(o, ctx))
        const decideMs = performance.now() - t0

        const r: DayResult = {
          date,
          label,
          orders: 0,
          byTier: { none: 0, single: 0, double: 0 },
          underByOriginToday: 0,
          underByDestToday: 0,
          underByDestDelivery: 0,
          worstNotShipDay: 0,
          costDouble: 0,
          costEngine: 0,
          linersSaved: 0,
          icePacksSaved: 0,
          valueUnderpacked: 0,
          decideMs,
        }

        decisions.forEach((d: Decision, i) => {
          if (d.status !== 'ok' || !d.worst) return
          r.orders++
          r.byTier[d.tier]++
          if (d.worst.role !== 'origin') r.worstNotShipDay++

          const dest = destOf.get(orders[i].id)
          if (!dest) return
          const originToday = highAt(forecasts, origin, d.shipDate)
          const destToday = highAt(forecasts, dest, d.shipDate)
          const destDelivery = highAt(forecasts, dest, d.deliveryDate)
          const rank = TIER_RANK[d.tier]
          if (originToday !== null && TIER_RANK[tierFromHigh(originToday, d.thresholds)] < rank) r.underByOriginToday++
          if (destToday !== null && TIER_RANK[tierFromHigh(destToday, d.thresholds)] < rank) {
            r.underByDestToday++
            r.valueUnderpacked += orderValue.get(d.orderId) ?? 0
          }
          if (destDelivery !== null && TIER_RANK[tierFromHigh(destDelivery, d.thresholds)] < rank) r.underByDestDelivery++

          const everything = materialsFor('double', d.transitDays, settings)
          r.costDouble += everything.cost
          r.costEngine += d.cost
          r.linersSaved += everything.liners - d.liners
          r.icePacksSaved += everything.icePacks - d.icePacks
        })
        r.costDouble = Math.round(r.costDouble * 100) / 100
        r.costEngine = Math.round(r.costEngine * 100) / 100
        r.valueUnderpacked = Math.round(r.valueUnderpacked * 100) / 100
        results.push(r)
      }

      const pct = (n: number, of: number) => (of === 0 ? '0' : ((n / of) * 100).toFixed(0))
      const line = (...c: (string | number)[]) => console.log(c.map((x) => String(x)).join('\t'))

      console.log('\n=== ColdChain impact, 50-order sample, real recorded weather ===\n')
      line('Ship day', 'Judged', 'None', 'Single', 'Double', 'Hottest day is not ship day', 'Under-packed by checking origin today', 'Under-packed by checking destination today', 'Packaging vs double-packing everything')
      for (const r of results) {
        line(
          `${r.date} (${r.label})`,
          r.orders,
          r.byTier.none,
          r.byTier.single,
          r.byTier.double,
          `${r.worstNotShipDay} (${pct(r.worstNotShipDay, r.orders)}%)`,
          `${r.underByOriginToday} (${pct(r.underByOriginToday, r.orders)}%)`,
          `${r.underByDestToday} (${pct(r.underByDestToday, r.orders)}%)`,
          `$${r.costEngine.toFixed(2)} vs $${r.costDouble.toFixed(2)}`,
        )
      }

      const judged = results.reduce((s, r) => s + r.orders, 0)
      const sum = (f: (r: DayResult) => number) => results.reduce((s, r) => s + f(r), 0)
      console.log('\n--- across all seven days ---')
      console.log(`orders judged                              ${judged}`)
      console.log(`hottest day was not the ship day           ${sum((r) => r.worstNotShipDay)} (${pct(sum((r) => r.worstNotShipDay), judged)}%)`)
      console.log(`under-packed by checking origin today      ${sum((r) => r.underByOriginToday)} (${pct(sum((r) => r.underByOriginToday), judged)}%)`)
      console.log(`under-packed by checking destination today ${sum((r) => r.underByDestToday)} (${pct(sum((r) => r.underByDestToday), judged)}%)`)
      console.log(`under-packed by checking delivery day only ${sum((r) => r.underByDestDelivery)} (${pct(sum((r) => r.underByDestDelivery), judged)}%)`)
      console.log(`product value on under-packed orders       $${sum((r) => r.valueUnderpacked).toFixed(2)}`)
      console.log(`packaging, engine                          $${sum((r) => r.costEngine).toFixed(2)}`)
      console.log(`packaging, double-pack everything          $${sum((r) => r.costDouble).toFixed(2)}`)
      console.log(`liners not pulled                          ${sum((r) => r.linersSaved)}`)
      console.log(`ice packs not pulled                       ${sum((r) => r.icePacksSaved)}`)
      console.log(`slowest decide() for 50 orders             ${Math.max(...results.map((r) => r.decideMs)).toFixed(1)} ms`)
      console.log(`distinct locations fetched                 ${points.size}`)
    console.log('')
  })
})
