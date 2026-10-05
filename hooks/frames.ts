// Pure helpers: fit the video into a cell grid and encode one frame as
// Raster cells. Each cell is '▀': foreground = top pixel, background =
// bottom pixel, so one terminal row shows two video rows.

export type Meta = {
  width: number
  height: number
  fps: number
  frames: number
  framesPerChunk: number
  chunks: number
}

export type Grid = { columns: number; rows: number }

const HALF_BLOCK = 0x2580
const WHITE = 0xffffff
const BLACK = 0x000000

// Biggest grid that keeps the video aspect inside the given room.
export function fitGrid(meta: Meta, maxColumns: number, maxRows: number): Grid {
  let columns = Math.max(1, Math.min(meta.width, maxColumns))
  let rows = Math.round((columns * meta.height) / meta.width / 2)
  if (rows > maxRows) {
    rows = Math.max(1, maxRows)
    columns = Math.max(1, Math.round((rows * 2 * meta.width) / meta.height))
  }
  return { columns: Math.min(columns, 512), rows: Math.max(1, Math.min(rows, 256)) }
}

// One frame from the packed 1-bit data (MSB first, row-major) as base64 cells.
export function encodeFrame(meta: Meta, bits: Uint8Array, frame: number, grid: Grid): string {
  const { width, height } = meta
  const base = frame * ((width * height) >> 3)
  const pixel = (x: number, y: number) => {
    const i = y * width + x
    return ((bits[base + (i >> 3)] ?? 0) >> (7 - (i & 7))) & 1
  }
  const words = new Uint32Array(grid.columns * grid.rows * 3)
  const pixelRows = grid.rows * 2
  let w = 0
  for (let r = 0; r < grid.rows; r++) {
    const top = Math.min(height - 1, Math.floor(((r * 2) * height) / pixelRows))
    const bottom = Math.min(height - 1, Math.floor(((r * 2 + 1) * height) / pixelRows))
    for (let c = 0; c < grid.columns; c++) {
      const x = Math.min(width - 1, Math.floor((c * width) / grid.columns))
      words[w++] = HALF_BLOCK
      words[w++] = pixel(x, top) ? WHITE : BLACK
      words[w++] = pixel(x, bottom) ? WHITE : BLACK
    }
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
