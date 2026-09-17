// Compiles the GeoNames US postal-code dump into a compact lookup table the app
// ships with, so zip → coordinates never depends on a network call.
//
//   npm run zips
//
// Output: public/data/zips.json  →  { "67202": [37.69, -97.34, "Wichita", "KS"], ... }
// Source: https://download.geonames.org/export/zip/US.zip  (CC BY 4.0, geonames.org)

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { inflateRawSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const cacheDir = join(here, '.cache')
const zipPath = join(cacheDir, 'US.zip')
const outPath = join(here, '..', 'public', 'data', 'zips.json')
const SOURCE = 'https://download.geonames.org/export/zip/US.zip'

mkdirSync(cacheDir, { recursive: true })
mkdirSync(dirname(outPath), { recursive: true })

if (!existsSync(zipPath)) {
  console.log(`downloading ${SOURCE}`)
  const res = await fetch(SOURCE)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath))
}

// Minimal ZIP reader: locate the entry via the central directory (local headers
// may carry zero sizes when the archive uses data descriptors), then inflate.
function readZipEntry(buf, wanted) {
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('not a zip archive')
  const entries = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < entries; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central directory')
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    if (name === wanted) {
      const lNameLen = buf.readUInt16LE(localOff + 26)
      const lExtraLen = buf.readUInt16LE(localOff + 28)
      const start = localOff + 30 + lNameLen + lExtraLen
      const data = buf.subarray(start, start + compSize)
      return method === 8 ? inflateRawSync(data) : data
    }
    off += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`${wanted} not found in archive`)
}

const txt = readZipEntry(readFileSync(zipPath), 'US.txt').toString('utf8')

// GeoNames columns: country, postal_code, place_name, admin_name1, admin_code1,
// admin_name2, admin_code2, admin_name3, admin_code3, latitude, longitude, accuracy
const table = {}
let rows = 0
for (const line of txt.split('\n')) {
  if (!line) continue
  const c = line.split('\t')
  const zip = c[1]
  if (!/^\d{5}$/.test(zip) || zip in table) continue
  const lat = Number(c[9])
  const lon = Number(c[10])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
  table[zip] = [Math.round(lat * 100) / 100, Math.round(lon * 100) / 100, c[2], c[4]]
  rows++
}

const json = JSON.stringify(table)
writeFileSync(outPath, json)
console.log(`wrote ${rows} zips → ${outPath} (${(json.length / 1024).toFixed(0)} KB)`)
