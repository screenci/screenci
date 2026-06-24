import { describe, it, expect, vi } from 'vitest'
import type { Page } from '@playwright/test'
import {
  bindStillCaptureToPage,
  resolveStillName,
  writeStillRecording,
} from './stillCapture.js'
import { NOOP_EVENT_RECORDER, type IEventRecorder } from './events.js'

describe('resolveStillName', () => {
  it('uses the explicit name when given', () => {
    expect(resolveStillName('hero', undefined, new Set())).toBe('hero')
  })

  it('falls back to the path basename without extension', () => {
    expect(resolveStillName(undefined, '/tmp/out/hero.png', new Set())).toBe(
      'hero'
    )
  })

  it('falls back to "screenshot" when neither is given', () => {
    expect(resolveStillName(undefined, undefined, new Set())).toBe('screenshot')
  })

  it('auto-indexes to stay unique within a recording', () => {
    const used = new Set<string>()
    expect(resolveStillName('hero', undefined, used)).toBe('hero')
    expect(resolveStillName('hero', undefined, used)).toBe('hero 2')
    expect(resolveStillName('hero', undefined, used)).toBe('hero 3')
  })
})

describe('bindStillCaptureToPage', () => {
  // Wrapping must be reversible. The screen recorder captures a baseline frame
  // via `page.screenshot()` when recording starts (and may capture on
  // pause/finalize). Those internal calls run while the wrapper is NOT installed:
  // the video fixture binds only around the user body and restores afterwards, so
  // the recorder's own captures never leak a `screenshot` still into `.screenci/`.
  function withRecordingDisabled<T>(fn: () => T): T {
    const previous = process.env.SCREENCI_RECORDING
    delete process.env.SCREENCI_RECORDING
    try {
      return fn()
    } finally {
      if (previous === undefined) delete process.env.SCREENCI_RECORDING
      else process.env.SCREENCI_RECORDING = previous
    }
  }

  it('wraps screenshot while bound and restores the native one', async () => {
    await withRecordingDisabled(async () => {
      const native = vi.fn(async () => Buffer.from('native'))
      const page = { screenshot: native } as unknown as Page

      const restore = bindStillCaptureToPage(page)

      // While bound, the wrapper strips the screenci-only keys before delegating.
      await (page.screenshot as (o?: unknown) => Promise<Buffer>)({
        name: 'hero',
        type: 'png',
      })
      expect(native).toHaveBeenCalledTimes(1)
      expect(native).toHaveBeenLastCalledWith({ type: 'png' })

      native.mockClear()
      restore()

      // After restore, the native screenshot is back: options pass through
      // untouched (the recorder's internal baseline capture is no longer wrapped).
      await (page.screenshot as (o?: unknown) => Promise<Buffer>)({
        name: 'hero',
        type: 'png',
      })
      expect(native).toHaveBeenCalledTimes(1)
      expect(native).toHaveBeenLastCalledWith({ name: 'hero', type: 'png' })
    })
  })
})

describe('writeStillRecording', () => {
  function makeRecorderSpy() {
    const writeToFile = vi.fn(async () => {})
    const start = vi.fn()
    const recorder: IEventRecorder = {
      ...NOOP_EVENT_RECORDER,
      start,
      writeToFile,
    }
    return { recorder, writeToFile, start }
  }

  it('writes a screenshot recording and returns the captured bytes', async () => {
    const rm = vi.fn(async () => {})
    const mkdir = vi.fn(async () => {})
    const bytes = Buffer.from('png-bytes')
    const capture = vi.fn(async () => bytes)
    const { recorder, writeToFile, start } = makeRecorderSpy()

    const result = await writeStillRecording({
      name: 'hero',
      screenciDir: '/repo/.screenci',
      dimensions: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      crop: {
        box: { x: 100, y: 100, width: 500, height: 500 },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        source: 'region',
      },
      testFilePath: '/repo/videos/demo.screenci.ts',
      configDir: '/repo',
      recordOptions: { aspectRatio: '16:9', quality: '1080p' },
      renderOptions: undefined,
      deps: { capture, fs: { rm, mkdir }, makeRecorder: () => recorder },
    })

    expect(result).toBe(bytes)

    // The still's directory and title are exactly the given name.
    expect(rm).toHaveBeenCalledWith('/repo/.screenci/hero')
    expect(mkdir).toHaveBeenCalledWith('/repo/.screenci/hero')
    expect(capture).toHaveBeenCalledWith('/repo/.screenci/hero/screenshot.png')
    expect(start).toHaveBeenCalledOnce()

    expect(writeToFile).toHaveBeenCalledOnce()
    const [dir, title, sourceFile, options] = writeToFile.mock.calls[0]
    expect(dir).toBe('/repo/.screenci/hero')
    expect(title).toBe('hero')
    expect(sourceFile).toBe('videos/demo.screenci.ts')
    // Crop is a render option, passed as a sibling of `screenshot` so writeToFile
    // merges it into renderOptions.screenshot.crop.
    expect(options).toEqual({
      output: 'screenshot',
      screenshot: {
        path: 'screenshot.png',
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
      },
      crop: {
        box: { x: 100, y: 100, width: 500, height: 500 },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        source: 'region',
      },
    })
  })

  it('scales recorded dimensions by deviceScaleFactor and omits an absent crop', async () => {
    const capture = vi.fn(async () => Buffer.from(''))
    const { recorder, writeToFile } = makeRecorderSpy()

    await writeStillRecording({
      name: 'shot',
      screenciDir: '/repo/.screenci',
      dimensions: { width: 800, height: 600 },
      deviceScaleFactor: 2,
      testFilePath: null,
      configDir: '/repo',
      recordOptions: undefined,
      renderOptions: undefined,
      deps: {
        capture,
        fs: { rm: async () => {}, mkdir: async () => {} },
        makeRecorder: () => recorder,
      },
    })

    const options = writeToFile.mock.calls[0][3]
    expect(options.screenshot.width).toBe(1600)
    expect(options.screenshot.height).toBe(1200)
    // No crop passed -> no crop key at all.
    expect(options).not.toHaveProperty('crop')
    // No test file path -> no source file argument.
    expect(writeToFile.mock.calls[0][2]).toBeUndefined()
  })
})
