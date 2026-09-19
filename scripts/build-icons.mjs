// Renders the ColdChain seal as PNGs for the web manifest without any image
// dependency: gold rings and a six-arm ice crystal around a chocolate square,
// on cocoa. Shapes are drawn by distance-to-geometry per pixel, supersampled.
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
const GOLD = [0xd9, 0xb8, 0x78]
const CHOC = [0x8a, 0x5a, 0x3a]

function crc32(buf) {
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
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

// --- geometry in a 48-unit box, matching the SVG mark ---
const C = 24
const segments = []
for (const deg of [0, 60, 120, 180, 240, 300]) {
  const a = (deg * Math.PI) / 180
  const rot = (x, y) => {
    const dx = x - C
    const dy = y - C
    return [C + dx * Math.cos(a) - dy * Math.sin(a), C + dx * Math.sin(a) + dy * Math.cos(a)]
  }
  segments.push([rot(24, 24), rot(24, 8.5)], [rot(24, 12.5), rot(21.2, 9.7)], [rot(24, 12.5), rot(26.8, 9.7)])
}

function distToSegment(px, py, [[x1, y1], [x2, y2]]) {
  const dx = x2 - x1
  const dy = y2 - y1
  const l2 = dx * dx + dy * dy
  let t = l2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  const qx = x1 + t * dx
  const qy = y1 + t * dy
  return Math.hypot(px - qx, py - qy)
}

function inRoundedRect(x, y, x0, y0, w, h, r) {
  if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false
  const cx = Math.max(x0 + r, Math.min(x, x0 + w - r))
  const cy = Math.max(y0 + r, Math.min(y, y0 + h - r))
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

/** Color at a point in the 48-unit box, or null for transparent. */
function sample(u, v, maskable) {
  const radius = maskable ? 0 : 10
  if (!inRoundedRect(u, v, 0, 0, 48, 48, radius)) return null
  const d = Math.hypot(u - C, v - C)
  if (Math.abs(d - 22) < 0.7) return GOLD
  if (Math.abs(d - 18.6) < 0.3) return GOLD
  // chocolate square, rotated 45°
  const a = Math.PI / 4
  const rx = C + (u - C) * Math.cos(-a) - (v - C) * Math.sin(-a)
  const ry = C + (u - C) * Math.sin(-a) + (v - C) * Math.cos(-a)
  if (inRoundedRect(rx, ry, 19.6, 19.6, 8.8, 8.8, 1.2)) {
    return inRoundedRect(rx, ry, 20.5, 20.5, 7, 7, 0.8) ? CHOC : GOLD
  }
  let best = Infinity
  for (const s of segments) best = Math.min(best, distToSegment(u, v, s))
  if (best < 0.75) return GOLD
  return COCOA
}

function render(size, maskable) {
  const px = Buffer.alloc(size * size * 4)
  const SS = 3 // supersampling per axis
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size) * 48
          const v = ((y + (sy + 0.5) / SS) / size) * 48
          const c = sample(u, v, maskable)
          if (c) {
            r += c[0]
            g += c[1]
            b += c[2]
            a += 255
          }
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      const cov = a / n
      if (cov > 0) {
        // un-premultiply against covered samples
        const k = a / 255
        px[i] = Math.round(r / k)
        px[i + 1] = Math.round(g / k)
        px[i + 2] = Math.round(b / k)
        px[i + 3] = Math.round(cov)
      }
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
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
