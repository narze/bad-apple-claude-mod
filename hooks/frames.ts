// Pure helpers: fit the video into a cell grid and encode one frame as
// Raster cells. Each cell is a solid quadrant glyph over 2x2 quarters with
// two gray levels: each quarter's gray is the share of its source pixels
// lit, and the glyph and grays are the best two-tone fit, so edges come
// out antialiased.

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
// Gray steps: 32 levels keep the fg/bg pairs within the Raster's 1024.
const LEVELS = 31

const PATTERNS = [15, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

function gray(share: number): number {
  const v = Math.round((Math.round(share * LEVELS) * 255) / LEVELS)
  return (v << 16) | (v << 8) | v
}

// Biggest grid that keeps the video aspect inside the given room, never
// more quarters than the video has pixels for. A cell is about twice as
// tall as wide, so rows = columns * height / width / 2.
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
// At 96x36 cells a 192x144 video gives each quarter a 1x2 pixel block;
// smaller grids average bigger blocks, so nothing is upscaled. With
// `isMono` each quarter is cut to black or white: no gray, crisp edges.
export function encodeFrame(meta: Meta, bits: Uint8Array, frame: number, grid: Grid, isMono = false): string {
  const { width, height } = meta
  const base = frame * ((width * height) >> 3)
  const source = (x: number, y: number) => {
    const i = y * width + x
    return ((bits[base + (i >> 3)] ?? 0) >> (7 - (i & 7))) & 1
  }
  const xs = spans(grid.columns * 2, width)
  const ys = spans(grid.rows * 2, height)
  const share = (qx: number, qy: number) => {
    const [x0, x1] = xs[qx] ?? [0, 1]
    const [y0, y1] = ys[qy] ?? [0, 1]
    let on = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) on += source(x, y)
    const lit = on / ((x1 - x0) * (y1 - y0))
    return isMono ? (lit >= 0.5 ? 1 : 0) : lit
  }
  const words = new Uint32Array(grid.columns * grid.rows * 3)
  const quarter = [0, 0, 0, 0]
  let w = 0
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.columns; c++) {
      // top-left, top-right, bottom-left, bottom-right: bits 8, 4, 2, 1
      quarter[0] = share(c * 2, r * 2)
      quarter[1] = share(c * 2 + 1, r * 2)
      quarter[2] = share(c * 2, r * 2 + 1)
      quarter[3] = share(c * 2 + 1, r * 2 + 1)
      let best = 15
      let bestError = Infinity
      let fg = 0
      let bg = 0
      // The cell as one tone (15) first, then every split into a lit set and
      // the rest; a split wins only when it fits strictly better.
      for (const pattern of PATTERNS) {
        let litSum = 0
        let litCount = 0
        let restSum = 0
        for (let q = 0; q < 4; q++) {
          if (pattern & (8 >> q)) {
            litSum += quarter[q] ?? 0
            litCount++
          } else {
            restSum += quarter[q] ?? 0
          }
        }
        const litMean = litSum / litCount
        const restMean = litCount === 4 ? litMean : restSum / (4 - litCount)
        let error = 0
        for (let q = 0; q < 4; q++) {
          const mean = pattern & (8 >> q) ? litMean : restMean
          error += ((quarter[q] ?? 0) - mean) ** 2
        }
        if (error < bestError - 1e-9) {
          best = pattern
          bestError = error
          fg = litMean
          bg = restMean
        }
      }
      // The brighter part is the glyph, so a shape reads the same each way.
      if (best !== 15 && fg < bg) {
        best = 15 - best
        ;[fg, bg] = [bg, fg]
      }
      words[w++] = QUADRANTS[best] ?? 0x2588
      words[w++] = gray(fg)
      words[w++] = gray(best === 15 ? fg : bg)
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
