import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const SIZE = 81
const outputDir = path.resolve('static/tabbar')

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, crc])
}

function png(pixels) {
  const rows = []
  for (let y = 0; y < SIZE; y += 1) {
    rows.push(Buffer.from([0]), pixels.subarray(y * SIZE * 4, (y + 1) * SIZE * 4))
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(SIZE, 0)
  header.writeUInt32BE(SIZE, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function canvas(color) {
  const pixels = Buffer.alloc(SIZE * SIZE * 4)
  const [r, g, b] = color
  function set(x, y, alpha = 255) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
    const offset = (Math.round(y) * SIZE + Math.round(x)) * 4
    pixels[offset] = r
    pixels[offset + 1] = g
    pixels[offset + 2] = b
    pixels[offset + 3] = alpha
  }
  function line(x1, y1, x2, y2, width = 5) {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
    for (let i = 0; i <= steps; i += 1) {
      const x = x1 + ((x2 - x1) * i) / steps
      const y = y1 + ((y2 - y1) * i) / steps
      for (let dx = -width; dx <= width; dx += 1) {
        for (let dy = -width; dy <= width; dy += 1) {
          if (dx * dx + dy * dy <= width * width) set(x + dx, y + dy)
        }
      }
    }
  }
  function circle(cx, cy, radius, width = 5) {
    for (let angle = 0; angle < Math.PI * 2; angle += 0.012) {
      const x = cx + Math.cos(angle) * radius
      const y = cy + Math.sin(angle) * radius
      for (let dx = -width; dx <= width; dx += 1) {
        for (let dy = -width; dy <= width; dy += 1) {
          if (dx * dx + dy * dy <= width * width) set(x + dx, y + dy)
        }
      }
    }
  }
  return { pixels, line, circle }
}

function drawIcon(name, active, painter) {
  const color = active ? [11, 58, 130] : [125, 135, 152]
  const c = canvas(color)
  painter(c)
  fs.writeFileSync(path.join(outputDir, `${name}${active ? '-active' : ''}.png`), png(c.pixels))
}

function home(c) {
  c.line(15, 38, 40, 16, 4)
  c.line(40, 16, 66, 38, 4)
  c.line(21, 34, 21, 66, 4)
  c.line(59, 34, 59, 66, 4)
  c.line(21, 66, 59, 66, 4)
  c.line(34, 66, 34, 49, 4)
  c.line(47, 49, 47, 66, 4)
  c.line(34, 49, 47, 49, 4)
}

function services(c) {
  ;[[24, 24], [56, 24], [24, 56], [56, 56]].forEach(([x, y]) => c.circle(x, y, 9, 4))
}

function community(c) {
  c.circle(30, 30, 12, 4)
  c.circle(54, 34, 10, 4)
  c.line(13, 65, 17, 55, 4)
  c.line(17, 55, 27, 49, 4)
  c.line(27, 49, 39, 52, 4)
  c.line(39, 52, 44, 62, 4)
  c.line(44, 62, 44, 67, 4)
  c.line(45, 54, 54, 51, 4)
  c.line(54, 51, 64, 57, 4)
  c.line(64, 57, 68, 66, 4)
}

function mine(c) {
  c.circle(40, 27, 13, 4)
  c.line(18, 67, 21, 55, 4)
  c.line(21, 55, 30, 47, 4)
  c.line(30, 47, 50, 47, 4)
  c.line(50, 47, 59, 55, 4)
  c.line(59, 55, 63, 67, 4)
  c.line(18, 67, 63, 67, 4)
}

function chat(c) {
  c.line(17,20,64,20,3); c.line(64,20,64,54,3); c.line(64,54,37,54,3)
  c.line(37,54,22,65,3); c.line(22,65,24,54,3); c.line(24,54,17,54,3); c.line(17,54,17,20,3)
  c.line(28,32,53,32,2); c.line(28,42,46,42,2)
}

fs.mkdirSync(outputDir, { recursive: true })
for (const active of [false, true]) {
  drawIcon('home', active, home)
  drawIcon('services', active, services)
  drawIcon('community', active, community)
  drawIcon('mine', active, mine)
  drawIcon('chat', active, chat)
}

console.log(`Generated 10 tabBar icons in ${outputDir}`)
