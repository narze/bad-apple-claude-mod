import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { clockText, encodeFrame, encodeProgress, fitGrid, id3End, joinChunks, songFrom, type Meta } from './frames.ts'

const META: Meta = { width: 8, height: 4, fps: 30, frames: 2, framesPerChunk: 1, chunks: 2 }

function cellsOf(base64: string) {
  return new Uint32Array(Uint8Array.fromBase64(base64).buffer)
}

test('fitGrid keeps the 4:3 aspect and never upscales', () => {
  const big: Meta = { ...META, width: 192, height: 144 }
  expect(fitGrid(big, 200, 100)).toEqual({ columns: 96, rows: 36 })
  expect(fitGrid(big, 48, 100)).toEqual({ columns: 48, rows: 18 })
  expect(fitGrid(big, 200, 18)).toEqual({ columns: 48, rows: 18 })
})

// 8x4 pixels, MSB first per row of 8
const FRAMES = joinChunks([
  Uint8Array.of(0xff, 0x00, 0x00, 0x00), // 0: top row lit
  Uint8Array.of(0xff, 0xff, 0xff, 0xff), // 1: all lit
  Uint8Array.of(0x00, 0x00, 0x00, 0x00), // 2: all dark
  Uint8Array.of(0xaa, 0xaa, 0xaa, 0xaa), // 3: left column of every cell
  Uint8Array.of(0xf0, 0xf0, 0xf0, 0xf0), // 4: left half lit
])

function cells(frame: number, grid: { columns: number; rows: number }) {
  const words = cellsOf(encodeFrame(META, FRAMES, frame, grid))
  expect(words.length).toBe(grid.columns * grid.rows * 3)
  return Array.from({ length: grid.columns * grid.rows }, (_, i) => ({
    glyph: String.fromCodePoint(words[i * 3] ?? 0),
    fg: words[i * 3 + 1] ?? 0,
    bg: words[i * 3 + 2] ?? 0,
  }))
}
const glyphs = (frame: number, grid: { columns: number; rows: number }) =>
  cells(frame, grid).map(cell => cell.glyph).join('')

test('encodeFrame draws solid quadrant blocks, brighter part as foreground', () => {
  const grid = { columns: 4, rows: 1 }
  expect(glyphs(1, grid)).toBe('████')
  expect(cells(1, grid)[0]).toEqual({ glyph: '█', fg: 0xffffff, bg: 0xffffff })
  expect(glyphs(2, grid)).toBe('████')
  expect(cells(2, grid)[0]).toEqual({ glyph: '█', fg: 0x000000, bg: 0x000000 })
  expect(glyphs(3, grid)).toBe('▌▌▌▌')
  expect(cells(3, grid)[0]).toEqual({ glyph: '▌', fg: 0xffffff, bg: 0x000000 })
  expect(glyphs(4, grid)).toBe('████')
  expect(cells(4, grid).map(cell => cell.fg)).toEqual([0xffffff, 0xffffff, 0x000000, 0x000000])
})

test('encodeFrame antialiases partly lit quarters with gray', () => {
  // each quarter of a 4x1 grid covers 1x2 pixels: row 0 lit is half coverage
  const top = cells(0, { columns: 4, rows: 1 })[0]
  expect(top?.glyph).toBe('▀')
  expect(top?.bg).toBe(0x000000)
  expect(top?.fg).toBe(0x848484)
  // 2x1 grid: each quarter covers 2x2 pixels, half lit, so the cell is mid gray
  expect(cells(3, { columns: 2, rows: 1 })[0]).toEqual({ glyph: '█', fg: 0x848484, bg: 0x848484 })
})

test('encodeProgress shows the time and a bar that fills by eighths', () => {
  const rowsOf = (base64: string, columns: number) => {
    const words = cellsOf(base64)
    const row = (r: number) =>
      Array.from({ length: columns }, (_, c) => String.fromCodePoint(words[(r * columns + c) * 3] ?? 0)).join('')
    return [row(0), row(1)]
  }
  expect(rowsOf(encodeProgress(0, 200, 10), 10)).toEqual(['0:00 / 3:2', '          '])
  expect(rowsOf(encodeProgress(100, 200, 16), 16)).toEqual(['1:40 / 3:20     ', '████████        '])
  expect(rowsOf(encodeProgress(25 + 25 / 8 * 3, 200, 8), 8)[1]).toBe('█▍      ')
  expect(rowsOf(encodeProgress(200, 200, 4), 4)[1]).toBe('████')
})

test('clockText formats minutes and seconds', () => {
  expect(clockText(0)).toBe('0:00')
  expect(clockText(219.1)).toBe('3:39')
})

// The engine's own band beneath the plugin: one plain Text.
function engineBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine band') as RenderElement
  })
}

// Beneath the plugin: the engine's calls it makes, answered in memory.
function fakeEngine(on: On) {
  engineBand(on)
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  mock.clock(on)
  const opened: string[] = []
  on('audio.play', async () => ({ value: undefined }))
  on('ui.open', async ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', async () => ({ value: undefined }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.blit', async () => ({ value: {} }))
  on('fs.exists', async () => ({ value: true }))
  on('fs.read', async ($, e) => {
    if (e.path.endsWith('meta.json')) return { value: JSON.stringify(META) }
    return { value: { base64: Uint8Array.of(0xff, 0, 0, 0).toBase64() } }
  })
  return opened
}

const BAND = {
  plugin: 'bad-apple',
  surface: 'terminal',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 60, scroll: { offset: 0, bodyRows: 19, contentRows: 4 }, view: {} },
} as never

test('songFrom skips the ID3 tag and cuts at the byte rate', () => {
  // ID3 header with a syncsafe size of 2, then audio bytes 1..8
  const mp3 = Uint8Array.of(0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 2, 0xaa, 0xbb, 1, 2, 3, 4, 5, 6, 7, 8)
  expect(id3End(mp3)).toBe(12)
  expect(Array.from(songFrom(mp3, 0, 4))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  expect(Array.from(songFrom(mp3, 1000, 4))).toEqual([5, 6, 7, 8])
  expect(Array.from(songFrom(mp3, 9000, 4))).toEqual([])
  expect(id3End(Uint8Array.of(0xff, 0xfb))).toBe(0)
})

test('/bad-apple pane opens the pane and draws a Raster', async ($, on) => {
  const opened = fakeEngine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'bad-apple', args: 'pane' } as never)
  expect(ran.text).toContain('Playing Bad Apple')
  expect(opened).toEqual(['bad-apple'])
  const ui = await $.ui.mount({
    plugin: 'bad-apple',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'bad-apple',
    props: {
      title: 'Bad Apple!!',
      isFocused: true,
      bodyColumns: 8,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 3, contentRows: 3 },
      view: {},
    },
  } as never)
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  await ui.unmount()
})

test('/bad-apple plays in the band by default until Stop', async ($, on) => {
  const opened = fakeEngine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'bad-apple', args: '' } as never)
  expect(ran.text).toContain('above the prompt')
  expect(opened).toEqual([])
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'video' })).toBeDefined()
  expect((await ui.find({ key: 'progress' }))?.props).toMatchObject({ columns: 20, rows: 2 })
  await ui.press({ key: 'stop' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('Pause and Resume toggle the band player', async ($, on) => {
  fakeEngine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'bad-apple', args: '' } as never)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ text: 'now playing' })).toBeDefined()
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ text: 'paused' })).toBeDefined()
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('Resume')
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ text: 'now playing' })).toBeDefined()
  const again = await $.command.run({ command: 'bad-apple', args: 'resume' } as never)
  expect(again.text).toBe('Bad Apple!! is not paused.')
  await ui.unmount()
})

test('Restart plays from the start in the same site', async ($, on) => {
  const opened = fakeEngine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'bad-apple', args: '' } as never)
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ text: 'paused' })).toBeDefined()
  await ui.press({ key: 'restart' })
  expect(await ui.find({ text: 'now playing' })).toBeDefined()
  expect(await ui.find({ key: 'video' })).toBeDefined()
  expect(opened).toEqual([])
  const ran = await $.command.run({ command: 'bad-apple', args: 'restart' } as never)
  expect(ran.text).toBe('Bad Apple!! restarted.')
  await ui.unmount()
})

test('restart with nothing playing starts the band', async ($, on) => {
  fakeEngine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'bad-apple', args: 'restart' } as never)
  expect(ran.text).toContain('above the prompt')
})

test('band stays empty while nothing plays', async ($, on) => {
  engineBand(on)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('without built assets it says how to build them', async ($, on) => {
  engineBand(on)
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('ui.close', async () => ({ value: undefined }))
  on('ui.status', async () => ({ value: undefined }))
  on('fs.exists', async () => ({ value: false }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'bad-apple', args: '' } as never)
  expect(ran.text).toContain('scripts/build-assets.sh')
})
