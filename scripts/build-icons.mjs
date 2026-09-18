// Renders the app icon as PNGs for the web manifest without any image
// dependency: a cocoa rounded square with a kraft box and a cold-blue band.
//
//   node scripts/build-icons.mjs

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const COCOA = [0x2b, 0x1a, 0x12]
const KRAFT = [0xc9, 0xa2, 0x7a]
const KRAFT_DARK = [0xb2, 0x8a, 0x63]
const BAND = [0x7f, 0xa7, 0xc4]

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function inRoundedRect(x, y, x0, y0, w, h, r) {
  if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false
  const cx = Math.max(x0 + r, Math.min(x, x0 + w - r))
  const cy = Math.max(y0 + r, Math.min(y, y0 + h - r))
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function render(size, maskable) {
  const px = Buffer.alloc(size * size * 4)
  const pad = maskable ? 0 : 0
  const radius = maskable ? 0 : size * 0.19
  // Box geometry in icon units (0..1)
  const bx = 0.22, by = 0.3, bw = 0.56, bh = 0.44, br = 0.05
  const lid = 0.14
  const bandW = 0.1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size
      let color = null
      if (inRoundedRect(x, y, pad, pad, size - 2 * pad, size - 2 * pad, radius)) color = COCOA
      if (color && inRoundedRect(u, v, bx, by, bw, bh, br)) {
        color = v < by + lid ? KRAFT_DARK : KRAFT
        if (Math.abs(u - 0.5) < bandW / 2) color = BAND
        if (Math.abs(v - (by + lid + 0.08)) < 0.03) color = BAND
      }
      if (color) {
        px[i] = color[0]
        px[i + 1] = color[1]
        px[i + 2] = color[2]
        px[i + 3] = 255
      }
    }
  }
  // PNG: filter byte 0 per row
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
]) {
  writeFileSync(join(outDir, name), render(size, maskable))
  console.log('wrote', name)
}
