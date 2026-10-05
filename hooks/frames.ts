// Pure helpers: fit the video into a cell grid and encode one frame as
// Raster cells. Each cell covers 2x4 video pixels, white on black: a braille
// glyph in general, a solid quadrant block where the pixels allow one (so
// white areas show solid, not dotted).

export type Meta = {
  width: number
  height: number
  fps: number
  frames: number
  framesPerChunk: number
  chunks: number
}

export type Grid = { columns: number; rows: number }

const WHITE = 0xffffff
const BLACK = 0x000000
const DEFAULT = 0x01000000
const TRACK = 0x3a3a3a
const FULL = 0x2588

// Quadrant glyph by lit quarters: top-left 8, top-right 4, bottom-left 2, bottom-right 1.
const QUADRANTS = [
  0x20, 0x2597, 0x2596, 0x2584, 0x259d, 0x2590, 0x259e, 0x259f,
  0x2598, 0x259a, 0x258c, 0x2599, 0x2580, 0x259c, 0x259b, 0x2588,
]
// Braille dot bit for pixel (x, y) of a 2x4 cell.
const DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

// Biggest grid that keeps the video aspect inside the given room, never
// more cells than the video has pixels for (2x4 each). A cell is about
// twice as tall as wide, so its 2x4 pixels are square.
export function fitGrid(meta: Meta, maxColumns: number, maxRows: number): Grid {
  let columns = Math.max(1, Math.min(meta.width >> 1, maxColumns))
  let rows = Math.round((columns * meta.height) / meta.width / 2)
  if (rows > maxRows) {
    rows = Math.max(1, maxRows)
    columns = Math.max(1, Math.round((rows * 2 * meta.width) / meta.height))
  }
  return { columns: Math.min(columns, 512), rows: Math.max(1, Math.min(rows, 256)) }
}

// Source pixel ranges [start, end) for each of `count` target pixels over `size`.
function spans(count: number, size: number): Array<[number, number]> {
  return Array.from({ length: count }, (_, i) => {
    const start = Math.min(size - 1, Math.floor((i * size) / count))
    return [start, Math.max(start + 1, Math.floor(((i + 1) * size) / count))]
  })
}

// One frame from the packed 1-bit data (MSB first, row-major) as base64 cells.
// At 2x4 pixels per cell a 192x144 video maps one to one onto 96x36 cells;
// a smaller grid lights a pixel when half its source block is lit.
export function encodeFrame(meta: Meta, bits: Uint8Array, frame: number, grid: Grid): string {
  const { width, height } = meta
  const base = frame * ((width * height) >> 3)
  const source = (x: number, y: number) => {
    const i = y * width + x
    return ((bits[base + (i >> 3)] ?? 0) >> (7 - (i & 7))) & 1
  }
  const xs = spans(grid.columns * 2, width)
  const ys = spans(grid.rows * 4, height)
  const lit = (px: number, py: number) => {
    const [x0, x1] = xs[px] ?? [0, 1]
    const [y0, y1] = ys[py] ?? [0, 1]
    if (x1 - x0 === 1 && y1 - y0 === 1) return source(x0, y0)
    let on = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) on += source(x, y)
    return on * 2 >= (x1 - x0) * (y1 - y0) ? 1 : 0
  }
  const words = new Uint32Array(grid.columns * grid.rows * 3)
  let w = 0
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.columns; c++) {
      let dots = 0
      const cell: number[] = []
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 2; x++) {
          const on = lit(c * 2 + x, r * 4 + y)
          cell.push(on)
          if (on) dots |= DOTS[y]?.[x] ?? 0
        }
      }
      // A solid quadrant when rows 0-1 and rows 2-3 match pixel for pixel.
      const [a, b, c2, d, e, f, g, h] = cell
      const isQuadrant = a === c2 && b === d && e === g && f === h
      words[w++] = isQuadrant
        ? QUADRANTS[((a ?? 0) << 3) | ((b ?? 0) << 2) | ((e ?? 0) << 1) | (f ?? 0)] ?? 0x20
        : 0x2800 + dots
      words[w++] = WHITE
      words[w++] = BLACK
    }
  }
  return new Uint8Array(words.buffer).toBase64()
}

// Two rows of `columns` cells: "m:ss / m:ss", then a bar filled by eighths.
export function encodeProgress(elapsed: number, total: number, columns: number): string {
  const words = new Uint32Array(columns * 2 * 3)
  const text = `${clockText(elapsed)} / ${clockText(total)}`
  for (let c = 0; c < columns; c++) {
    words.set([text.codePointAt(c) ?? 0x20, DEFAULT, DEFAULT], c * 3)
  }
  const eighths = Math.round(Math.min(1, Math.max(0, elapsed / total)) * columns * 8)
  for (let c = 0; c < columns; c++) {
    const lit = Math.min(8, Math.max(0, eighths - c * 8))
    const glyph = lit === 8 ? FULL : lit === 0 ? 0x20 : 0x2590 - lit
    words.set([glyph, WHITE, TRACK], (columns + c) * 3)
  }
  return new Uint8Array(words.buffer).toBase64()
}

export function joinChunks(parts: Uint8Array[]): Uint8Array {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    all.set(p, at)
    at += p.length
  }
  return all
}

export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Where the MP3 frames start: after the ID3v2 tag, whose size is syncsafe.
export function id3End(bytes: Uint8Array): number {
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0
  const size = (((bytes[6] ?? 0) & 0x7f) << 21) | (((bytes[7] ?? 0) & 0x7f) << 14) |
    (((bytes[8] ?? 0) & 0x7f) << 7) | ((bytes[9] ?? 0) & 0x7f)
  return 10 + size
}

// The song from `ms` on: a constant-bitrate MP3 cut at a byte offset; the
// decoder finds the next frame by itself.
export function songFrom(bytes: Uint8Array, ms: number, bytesPerSecond: number): Uint8Array {
  const at = id3End(bytes) + Math.floor((ms / 1000) * bytesPerSecond)
  return bytes.subarray(Math.min(at, bytes.length))
}
