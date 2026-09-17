// Zip-code normalization and the bundled GeoNames lookup table.

/** [lat, lon, city, state] as emitted by scripts/build-zips.mjs */
export type ZipRow = [number, number, string, string]
export type ZipDb = Record<string, ZipRow>

export interface Place {
  zip: string
  lat: number
  lon: number
  city: string
  state: string
}

export interface ZipNormalization {
  zip: string | null
  /** What was changed or why it failed, in plain language. */
  note: string | null
}

/**
 * Turns whatever a spreadsheet exported into a 5-digit zip.
 * Handles ZIP+4, Shopify's leading apostrophe, and the leading zeros Excel drops.
 */
export function normalizeZip(raw: string | number | null | undefined): ZipNormalization {
  if (raw === null || raw === undefined) return { zip: null, note: 'Missing zip code' }
  let s = String(raw).trim().replace(/^'+/, '')
  if (s === '') return { zip: null, note: 'Missing zip code' }
  const plus4 = s.match(/^(\d{5})[- ]?\d{4}$/)
  if (plus4) return { zip: plus4[1], note: null }
  if (/^\d{5}$/.test(s)) return { zip: s, note: null }
  if (/^\d{3,4}$/.test(s)) {
    s = s.padStart(5, '0')
    return { zip: s, note: `Restored leading zero (read as ${s})` }
  }
  if (/^\d{9}$/.test(s)) return { zip: s.slice(0, 5), note: null }
  return { zip: null, note: `"${s}" is not a US zip code` }
}

export function lookupZip(db: ZipDb, zip: string): Place | null {
  const row = db[zip]
  if (!row) return null
  return { zip, lat: row[0], lon: row[1], city: row[2], state: row[3] }
}

const EARTH_RADIUS_MILES = 3958.8

export function haversineMiles(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h))
}

/** Point halfway along the great-circle path, used as a stand-in for the sort hub. */
export function midpoint(aLat: number, aLon: number, bLat: number, bLon: number): { lat: number; lon: number } {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const φ1 = toRad(aLat)
  const λ1 = toRad(aLon)
  const φ2 = toRad(bLat)
  const dλ = toRad(bLon - aLon)
  const bx = Math.cos(φ2) * Math.cos(dλ)
  const by = Math.cos(φ2) * Math.sin(dλ)
  const φ3 = Math.atan2(Math.sin(φ1) + Math.sin(φ2), Math.sqrt((Math.cos(φ1) + bx) ** 2 + by ** 2))
  const λ3 = λ1 + Math.atan2(by, Math.cos(φ1) + bx)
  return { lat: Math.round(toDeg(φ3) * 100) / 100, lon: Math.round(toDeg(λ3) * 100) / 100 }
}

/** States and territories ground service does not reach in normal transit times. */
export const NON_CONTIGUOUS = new Set(['AK', 'HI', 'PR', 'VI', 'GU', 'AS', 'MP'])

let dbPromise: Promise<ZipDb> | null = null

/** Loads the bundled table once; safe to call from many places. */
export function loadZipDb(baseUrl: string): Promise<ZipDb> {
  if (!dbPromise) {
    dbPromise = fetch(`${baseUrl}data/zips.json`).then((r) => {
      if (!r.ok) throw new Error(`zip table failed to load (${r.status})`)
      return r.json() as Promise<ZipDb>
    })
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}
