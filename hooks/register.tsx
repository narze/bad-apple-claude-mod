import { atom, read, update } from 'claude-code'
import type { Register, Timer } from 'claude-code'

import type { Mode } from '../types'
import { clockText, encodeFrame, encodeProgress, fitGrid, joinChunks, songFrom, type Grid, type Meta } from './frames.ts'

const PANE = 'bad-apple'
const RASTER = 'video'
const PROGRESS = 'progress'
const BAND_ROWS = 16
// Cells beside the video in the band: title, time, bar, buttons.
const INFO_COLUMNS = 20
// assets/bad-apple.mp3 is constant 96 kbit/s.
const SONG_BYTES_PER_SECOND = 12000

// Where it plays and whether it is paused; the band and the pane redraw
// when either changes.
const mode = atom({ plugin: 'bad-apple', key: 'mode' } as const, 'off' as Mode)
const isPaused = atom({ plugin: 'bad-apple', key: 'isPaused' } as const, false)

// Player state lives in the module: a reload drops the timer anyway, so
// a fresh load with a stopped player is the right state after one.
let meta: Meta | undefined
let bits: Uint8Array | undefined
let song: Uint8Array | undefined
let timer: Timer | undefined
let audio: AbortController | undefined
let frame = 0
// Song position in ms while paused; `startedAt` maps wall clock to it while playing.
let position = 0
let startedAt = 0
// The Rasters the ticker repaints: set by whichever site drew them last.
let target: { requestId: string; grid: Grid; bar: number } | undefined
let lastProgress = ''

function silence() {
  timer?.cancel()
  timer = undefined
  audio?.abort()
  audio = undefined
}

function halt() {
  silence()
  target = undefined
  lastProgress = ''
  position = 0
  frame = 0
}

type Action = 'band' | 'pane' | 'pause' | 'resume' | 'toggle' | 'restart' | 'stop'

// The player's verbs, made in session.start so a command and a Button press
// both reach them; set again on every load.
let player: ((action: Action) => Promise<string>) | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'bad-apple',
      description: 'Play Bad Apple!! above the prompt (pane, pause, resume, restart, stop)',
      argumentHint: '[pane|pause|resume|restart|stop]',
    })

    player = async asked => {
      const where = await read($, mode)
      const paused = await read($, isPaused)
      const action = asked === 'toggle'
        ? (paused ? 'resume' : 'pause')
        : asked === 'restart' && where === 'off' ? 'band' : asked

      if (action === 'pause') {
        if (where === 'off' || paused) return 'Bad Apple!! is not playing.'
        position = (await $.clock.now()) - startedAt
        silence()
        await update($, isPaused, () => true)
        $.ui.status(`⏸ Bad Apple!! ${clockText(position / 1000)}`)
        return 'Bad Apple!! paused.'
      }

      if (action === 'resume' && (where === 'off' || !paused)) return 'Bad Apple!! is not paused.'

      // Resume and restart keep playing where it is; the rest pick a site anew.
      const isSameSite = action === 'resume' || action === 'restart'
      if (action === 'restart') {
        silence()
        position = 0
        frame = 0
        lastProgress = ''
      }

      if (!isSameSite) {
        // Switch off the old site first, so its close does not stop the new one.
        halt()
        await update($, isPaused, () => false)
        await update($, mode, () => 'off')
        await $.ui.close({ id: PANE })
        $.ui.status(undefined)
        if (action === 'stop') return 'Bad Apple!! stopped.'
      }

      if (!meta || !bits || !song) {
        const dir = `${$.plugin.root}/assets`
        if (!(await $.fs.exists(`${dir}/meta.json`))) {
          return `No frames yet: run ${$.plugin.root}/scripts/build-assets.sh first.`
        }
        const info: Meta = JSON.parse(await $.fs.read(`${dir}/meta.json`))
        const parts: Uint8Array[] = []
        for (let i = 0; i < info.chunks; i++) {
          const { base64 } = await $.fs.read(`${dir}/frames-${i}.bin`, { as: 'bytes' })
          parts.push(Uint8Array.fromBase64(base64))
        }
        const mp3 = await $.fs.read(`${dir}/bad-apple.mp3`, { as: 'bytes' })
        bits = joinChunks(parts)
        song = Uint8Array.fromBase64(mp3.base64)
        meta = info
      }
      const video = meta
      const data = bits
      const total = clockText(video.frames / video.fps)

      if (!isSameSite) {
        await update($, mode, () => action)
        if (action === 'pane') {
          await $.ui.open({ id: PANE, title: 'Bad Apple!!', focus: true, closeOnEscape: true, rows: 40, columns: 98 })
        }
      }
      await update($, isPaused, () => false)

      audio = new AbortController()
      const clip = { base64: songFrom(song, position, SONG_BYTES_PER_SECOND).toBase64(), mime: 'audio/mpeg' }
      void $.audio.play(clip, { signal: audio.signal }).catch(() => {
        $.ui.toast('bad-apple: no sound here, video only')
      })
      startedAt = (await $.clock.now()) - position

      // Frame index comes from the wall clock, so video stays in sync with
      // the song even when a tick is late.
      const ticker: Timer = $.clock.every(16, async () => {
        if (timer !== ticker) return
        const elapsed = (await $.clock.now()) - startedAt
        const due = Math.floor((elapsed * video.fps) / 1000)
        if (due >= video.frames) {
          halt()
          await update($, mode, () => 'off')
          await $.ui.close({ id: PANE })
          $.ui.status(undefined)
          $.ui.toast('Bad Apple!! - fin')
          return
        }
        if (due === frame) return
        frame = due
        if (frame % video.fps === 0) {
          $.ui.status(`▶ Bad Apple!! ${clockText(elapsed / 1000)} / ${total}`)
        }
        if (target) {
          const { requestId, grid, bar } = target
          await $.ui.blit({ requestId, key: RASTER, cells: encodeFrame(video, data, frame, grid) })
          const progress = encodeProgress(frame / video.fps, video.frames / video.fps, bar)
          if (progress !== lastProgress) {
            lastProgress = progress
            await $.ui.blit({ requestId, key: PROGRESS, cells: progress })
          }
        }
      })
      timer = ticker

      if (action === 'resume') return 'Bad Apple!! resumed.'
      if (action === 'restart') return 'Bad Apple!! restarted.'
      return action === 'band'
        ? 'Playing Bad Apple!! above the prompt - /bad-apple stop ends it.'
        : 'Playing Bad Apple!! - Esc closes the pane.'
    }

    return next(e)
  })

  on('command.run', { command: 'bad-apple' }, async ($, e) => {
    const arg = e.args.trim() || 'band'
    const actions: Action[] = ['band', 'pane', 'pause', 'resume', 'toggle', 'restart', 'stop']
    const action = actions.find(one => one === arg)
    if (!action) return { text: `Unknown "${arg}". Use /bad-apple [pane|pause|resume|restart|stop].` }
    if (!player) return { text: 'bad-apple: not ready yet, try again.' }
    return { text: await player(action) }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && (await read($, mode)) === 'pane') {
      halt()
      await update($, isPaused, () => false)
      await update($, mode, () => 'off')
      $.ui.status(undefined)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    halt()
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const where = await read($, mode)
    if (where !== 'band' || e.props.hasSurvey || e.surface !== 'terminal' || !meta || !bits) {
      return next(e)
    }
    const paused = await read($, isPaused)
    const { Box, Text, Button, Raster } = $.ui.resolve(e)
    const grid = fitGrid(meta, e.props.bodyColumns - INFO_COLUMNS - 2, Math.min(BAND_ROWS, e.props.maxRows - 1))
    const progress = encodeProgress(frame / meta.fps, meta.frames / meta.fps, INFO_COLUMNS)
    target = { requestId: e.requestId, grid, bar: INFO_COLUMNS }
    lastProgress = progress
    return (
      <Box flexDirection="row" gap={2}>
        <Raster key={RASTER} columns={grid.columns} rows={grid.rows} cells={encodeFrame(meta, bits, frame, grid)} />
        <Box flexDirection="column">
          <Text bold>Bad Apple!!</Text>
          <Text dimColor>{paused ? 'paused' : 'now playing'}</Text>
          <Text> </Text>
          <Raster key={PROGRESS} columns={INFO_COLUMNS} rows={2} cells={progress} />
          <Text> </Text>
          <Button
            key="toggle"
            label={paused ? 'Resume' : 'Pause'}
            hotkey="p"
            variant="primary"
            onPress={() => player?.('toggle')}
          />
          <Button
            key="restart"
            label="Restart"
            hotkey="r"
            onPress={() => player?.('restart')}
          />
          <Button
            key="stop"
            label="Stop"
            hotkey="s"
            onPress={() => player?.('stop')}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' || !meta || !bits) {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>{meta ? 'Bad Apple!! plays in the terminal only.' : 'Loading frames…'}</Text>
    }
    const paused = await read($, isPaused)
    const { Box, Button, Raster } = $.ui.resolve(e)
    const grid = fitGrid(meta, e.props.bodyColumns, e.props.scroll.bodyRows - 2)
    const bar = Math.max(10, Math.min(40, grid.columns - 26))
    const progress = encodeProgress(frame / meta.fps, meta.frames / meta.fps, bar)
    target = { requestId: PANE, grid, bar }
    lastProgress = progress
    return (
      <Box flexDirection="column">
        <Raster key={RASTER} columns={grid.columns} rows={grid.rows} cells={encodeFrame(meta, bits, frame, grid)} />
        <Box flexDirection="row" gap={2}>
          <Button
            key="toggle"
            label={paused ? 'Resume' : 'Pause'}
            hotkey="p"
            onPress={() => player?.('toggle')}
          />
          <Button key="restart" label="Restart" hotkey="r" onPress={() => player?.('restart')} />
          <Raster key={PROGRESS} columns={bar} rows={2} cells={progress} />
        </Box>
      </Box>
    )
  })
}
