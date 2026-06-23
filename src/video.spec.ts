import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getDimensions, getViewportCenter } from './dimensions.js'
import { getMousePosition } from './mouse.js'
import {
  applyFirstPassEncoderArgs,
  assertAllOverlaysEnded,
  finalizeDeferredRecordingStops,
  overrideFirstPassEncoderArgs,
  POST_VIDEO_PAUSE,
  positionMouseAtViewportCenter,
  resolveRecordingFirstPassArgs,
  withActiveRecordingContext,
} from './video.js'
import {
  createOverlays,
  setActiveAssetRecorder,
  setAssetSleepFn,
} from './asset.js'
import { setHtmlRasterizer } from './htmlRasterizer.js'
import { EventRecorder, NOOP_EVENT_RECORDER } from './events.js'
import type { Page } from '@playwright/test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createScreenCIRuntimeContext,
  runWithScreenCIRuntimeContext,
} from './runtimeContext.js'

/** Read the value that follows a flag in an ffmpeg-style argv array. */
function argValue(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

/**
 * Dimension table (shorter side = quality base, longer side from ratio):
 *
 * | Aspect Ratio | 720p      | 1080p      | 1440p      | 2160p      |
 * |--------------|-----------|------------|------------|------------|
 * | 16:9         | 1280×720  | 1920×1080  | 2560×1440  | 3840×2160  |
 * | 9:16         | 720×1280  | 1080×1920  | 1440×2560  | 2160×3840  |
 * | 1:1          | 720×720   | 1080×1080  | 1440×1440  | 2160×2160  |
 * | 4:3          | 960×720   | 1440×1080  | 1920×1440  | 2880×2160  |
 * | 3:4          | 720×960   | 1080×1440  | 1440×1920  | 2160×2880  |
 * | 5:4          | 900×720   | 1350×1080  | 1800×1440  | 2700×2160  |
 * | 4:5          | 720×900   | 1080×1350  | 1440×1800  | 2160×2700  |
 */
describe('getDimensions', () => {
  describe('16:9 (landscape widescreen)', () => {
    it('720p → 1280×720', () => {
      expect(getDimensions('16:9', '720p')).toEqual({
        width: 1280,
        height: 720,
      })
    })
    it('1080p → 1920×1080', () => {
      expect(getDimensions('16:9', '1080p')).toEqual({
        width: 1920,
        height: 1080,
      })
    })
    it('1440p → 2560×1440', () => {
      expect(getDimensions('16:9', '1440p')).toEqual({
        width: 2560,
        height: 1440,
      })
    })
    it('2160p → 3840×2160', () => {
      expect(getDimensions('16:9', '2160p')).toEqual({
        width: 3840,
        height: 2160,
      })
    })
  })

  describe('9:16 (portrait / vertical)', () => {
    it('720p → 720×1280', () => {
      expect(getDimensions('9:16', '720p')).toEqual({
        width: 720,
        height: 1280,
      })
    })
    it('1080p → 1080×1920', () => {
      expect(getDimensions('9:16', '1080p')).toEqual({
        width: 1080,
        height: 1920,
      })
    })
    it('1440p → 1440×2560', () => {
      expect(getDimensions('9:16', '1440p')).toEqual({
        width: 1440,
        height: 2560,
      })
    })
    it('2160p → 2160×3840', () => {
      expect(getDimensions('9:16', '2160p')).toEqual({
        width: 2160,
        height: 3840,
      })
    })
  })

  describe('1:1 (square)', () => {
    it('720p → 720×720', () => {
      expect(getDimensions('1:1', '720p')).toEqual({ width: 720, height: 720 })
    })
    it('1080p → 1080×1080', () => {
      expect(getDimensions('1:1', '1080p')).toEqual({
        width: 1080,
        height: 1080,
      })
    })
    it('1440p → 1440×1440', () => {
      expect(getDimensions('1:1', '1440p')).toEqual({
        width: 1440,
        height: 1440,
      })
    })
    it('2160p → 2160×2160', () => {
      expect(getDimensions('1:1', '2160p')).toEqual({
        width: 2160,
        height: 2160,
      })
    })
  })

  describe('4:3 (landscape standard)', () => {
    it('720p → 960×720', () => {
      expect(getDimensions('4:3', '720p')).toEqual({ width: 960, height: 720 })
    })
    it('1080p → 1440×1080', () => {
      expect(getDimensions('4:3', '1080p')).toEqual({
        width: 1440,
        height: 1080,
      })
    })
    it('1440p → 1920×1440', () => {
      expect(getDimensions('4:3', '1440p')).toEqual({
        width: 1920,
        height: 1440,
      })
    })
    it('2160p → 2880×2160', () => {
      expect(getDimensions('4:3', '2160p')).toEqual({
        width: 2880,
        height: 2160,
      })
    })
  })

  describe('3:4 (portrait standard)', () => {
    it('720p → 720×960', () => {
      expect(getDimensions('3:4', '720p')).toEqual({ width: 720, height: 960 })
    })
    it('1080p → 1080×1440', () => {
      expect(getDimensions('3:4', '1080p')).toEqual({
        width: 1080,
        height: 1440,
      })
    })
    it('1440p → 1440×1920', () => {
      expect(getDimensions('3:4', '1440p')).toEqual({
        width: 1440,
        height: 1920,
      })
    })
    it('2160p → 2160×2880', () => {
      expect(getDimensions('3:4', '2160p')).toEqual({
        width: 2160,
        height: 2880,
      })
    })
  })

  describe('5:4 (landscape near-square)', () => {
    it('720p → 900×720', () => {
      expect(getDimensions('5:4', '720p')).toEqual({ width: 900, height: 720 })
    })
    it('1080p → 1350×1080', () => {
      expect(getDimensions('5:4', '1080p')).toEqual({
        width: 1350,
        height: 1080,
      })
    })
    it('1440p → 1800×1440', () => {
      expect(getDimensions('5:4', '1440p')).toEqual({
        width: 1800,
        height: 1440,
      })
    })
    it('2160p → 2700×2160', () => {
      expect(getDimensions('5:4', '2160p')).toEqual({
        width: 2700,
        height: 2160,
      })
    })
  })

  describe('4:5 (portrait near-square)', () => {
    it('720p → 720×900', () => {
      expect(getDimensions('4:5', '720p')).toEqual({ width: 720, height: 900 })
    })
    it('1080p → 1080×1350', () => {
      expect(getDimensions('4:5', '1080p')).toEqual({
        width: 1080,
        height: 1350,
      })
    })
    it('1440p → 1440×1800', () => {
      expect(getDimensions('4:5', '1440p')).toEqual({
        width: 1440,
        height: 1800,
      })
    })
    it('2160p → 2160×2700', () => {
      expect(getDimensions('4:5', '2160p')).toEqual({
        width: 2160,
        height: 2700,
      })
    })
  })
})

describe('getViewportCenter', () => {
  it('returns centered coordinates for even dimensions', () => {
    expect(getViewportCenter({ width: 1280, height: 720 })).toEqual({
      x: 640,
      y: 360,
    })
  })

  it('floors centered coordinates for odd dimensions', () => {
    expect(getViewportCenter({ width: 721, height: 1281 })).toEqual({
      x: 360,
      y: 640,
    })
  })
})

describe('startup mouse positioning', () => {
  it('uses the viewport center as the initial mouse position target', () => {
    expect(getViewportCenter(getDimensions('16:9', '720p'))).toEqual({
      x: 640,
      y: 360,
    })
  })

  it('tracks the centered startup mouse position after moving the real cursor', async () => {
    const move = vi.fn().mockResolvedValue(undefined)
    const page = {
      mouse: {
        _move: move,
      },
    } as never

    const result = await positionMouseAtViewportCenter(page, {
      width: 1280,
      height: 720,
    })

    expect(move).toHaveBeenCalledWith(640, 360)
    expect(result).toEqual({ x: 640, y: 360 })
    expect(getMousePosition(page)).toEqual({ x: 640, y: 360 })
  })
})

describe('assertAllOverlaysEnded', () => {
  // The recording lifecycle runs this on the success path: an overlay started
  // with start() but never end()ed is a hard error (the renderer would see a
  // dangling assetStart). Overlapping overlays each need their own end().
  it('throws naming overlays left started but not ended', async () => {
    const context = createScreenCIRuntimeContext()
    setAssetSleepFn(() => {})
    await runWithScreenCIRuntimeContext(context, async () => {
      setActiveAssetRecorder(NOOP_EVENT_RECORDER)
      const overlays = createOverlays({
        a: { path: './a.png' },
        b: { path: './b.png' },
      })
      await overlays.a.start()
      await overlays.b.start()
      await overlays.a.end()
      // "b" left open.
      expect(() => assertAllOverlaysEnded(context)).toThrow(
        'Overlay(s) "b" were started with .start() but never ended'
      )
    })
  })

  it('does not throw when every started overlay was ended', async () => {
    const context = createScreenCIRuntimeContext()
    setAssetSleepFn(() => {})
    await runWithScreenCIRuntimeContext(context, async () => {
      setActiveAssetRecorder(NOOP_EVENT_RECORDER)
      const overlays = createOverlays({
        a: { path: './a.png' },
        b: { path: './b.png' },
      })
      await overlays.a.start()
      await overlays.b.start()
      await overlays.a.end()
      await overlays.b.end()
      expect(() => assertAllOverlaysEnded(context)).not.toThrow()
    })
  })
})

describe('POST_VIDEO_PAUSE', () => {
  it('adds a 500ms tail before stopping recording resources', () => {
    expect(POST_VIDEO_PAUSE).toBe(500)
  })
})

describe('deferred recording stops', () => {
  it('does not stop recorders until shared finalization runs', async () => {
    const finalized = Promise.resolve({ written: true })
    const recorder = {
      stop: vi.fn().mockResolvedValue({ written: true }),
      finalized,
    }

    expect(recorder.stop).not.toHaveBeenCalled()

    await finalizeDeferredRecordingStops([{ recorder: recorder as never }])

    expect(recorder.stop).toHaveBeenCalledOnce()
  })

  it('waits for every deferred stop to finalize', async () => {
    let resolveFirst!: () => void
    let resolveSecond!: () => void
    const firstRecorder = {
      stop: vi.fn().mockResolvedValue({ written: true }),
      finalized: new Promise((resolve) => {
        resolveFirst = () => resolve({ written: true })
      }),
    }
    const secondRecorder = {
      stop: vi.fn().mockResolvedValue({ written: true }),
      finalized: new Promise((resolve) => {
        resolveSecond = () => resolve({ written: true })
      }),
    }

    let completed = false
    const finalizePromise = finalizeDeferredRecordingStops([
      { recorder: firstRecorder as never },
      { recorder: secondRecorder as never },
    ]).then(() => {
      completed = true
    })

    await Promise.resolve()
    expect(completed).toBe(false)

    resolveFirst()
    await Promise.resolve()
    expect(completed).toBe(false)

    resolveSecond()
    await finalizePromise

    expect(completed).toBe(true)
  })

  it('surfaces finalization failures from deferred stops', async () => {
    let rejectFinalized!: (error: Error) => void
    const finalized = new Promise((_, reject) => {
      rejectFinalized = reject
    })
    finalized.catch(() => {})
    const recorder = {
      stop: vi.fn().mockResolvedValue({ written: true }),
      finalized,
    }

    const finalizePromise = finalizeDeferredRecordingStops([
      { recorder: recorder as never },
    ])
    rejectFinalized(new Error('finalization failed'))

    await expect(finalizePromise).rejects.toThrow('finalization failed')
  })
})

describe('resolveRecordingFirstPassArgs', () => {
  it("defaults to the 'fast' preset (safe baseline)", () => {
    expect(resolveRecordingFirstPassArgs()).toEqual(
      resolveRecordingFirstPassArgs('fast')
    )
  })

  describe("'sharp'", () => {
    const args = resolveRecordingFirstPassArgs('sharp')

    it('encodes the kept first pass with libx264 tuned for text', () => {
      expect(argValue(args, '-c:v')).toBe('libx264')
      expect(argValue(args, '-tune')).toBe('stillimage')
    })

    it('uses a high-quality CRF for sharp glyph edges', () => {
      expect(Number(argValue(args, '-crf'))).toBeLessThanOrEqual(14)
    })

    it('stays above realtime by avoiding slow x264 presets', () => {
      // ScreenCI keeps the realtime first pass, so the preset must not let the
      // encoder fall behind the screencast stream (which drops frames).
      const slowPresets = ['slow', 'slower', 'veryslow', 'placebo']
      expect(slowPresets).not.toContain(argValue(args, '-preset'))
    })
  })

  describe("'fast'", () => {
    const args = resolveRecordingFirstPassArgs('fast')

    it('uses the lightest ultrafast preset for constrained CI', () => {
      expect(argValue(args, '-preset')).toBe('ultrafast')
    })

    it('omits the CPU-heavy stillimage tune', () => {
      expect(args).not.toContain('-tune')
    })
  })

  it('keeps yuv420p in both presets so the render pipeline can NVDEC-decode it', () => {
    for (const preset of ['sharp', 'fast'] as const) {
      const args = resolveRecordingFirstPassArgs(preset)
      expect(argValue(args, '-pix_fmt')).toBe('yuv420p')
      expect(argValue(args, '-movflags')).toBe('+faststart')
    }
  })
})

/**
 * Mirrors the first-pass argv the recorder builds: an mjpeg input decoder
 * (first `-c:v`), the rate/input flags, then the default output encoder (last
 * `-c:v`). The override must replace only the output-encoder tail.
 */
const BUILT_FIRST_PASS_ARGS = [
  '-loglevel',
  'error',
  '-f',
  'image2pipe',
  '-c:v',
  'mjpeg',
  '-r',
  '30',
  '-i',
  'pipe:0',
  '-y',
  '-an',
  '-fps_mode',
  'passthrough',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-crf',
  '18',
  '-pix_fmt',
  'yuv420p',
]

describe('overrideFirstPassEncoderArgs', () => {
  it('replaces everything from the last -c:v onward with the encoder args', () => {
    const result = overrideFirstPassEncoderArgs(BUILT_FIRST_PASS_ARGS, [
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
    ])
    expect(result).toEqual([
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-c:v',
      'mjpeg',
      '-r',
      '30',
      '-i',
      'pipe:0',
      '-y',
      '-an',
      '-fps_mode',
      'passthrough',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
    ])
  })

  it('preserves the mjpeg input decoder (the first -c:v)', () => {
    const result = overrideFirstPassEncoderArgs(
      BUILT_FIRST_PASS_ARGS,
      resolveRecordingFirstPassArgs('sharp')
    )
    // Input decoder stays mjpeg; output encoder tail becomes the sharp preset.
    expect(result.slice(0, 6)).toEqual([
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-c:v',
      'mjpeg',
    ])
    expect(argValue(result, '-tune')).toBe('stillimage')
    expect(result.lastIndexOf('-c:v')).toBeGreaterThan(result.indexOf('-c:v'))
  })

  it('does not mutate the input array', () => {
    const input = [...BUILT_FIRST_PASS_ARGS]
    overrideFirstPassEncoderArgs(input, ['-c:v', 'libx264'])
    expect(input).toEqual(BUILT_FIRST_PASS_ARGS)
  })

  it('throws when no output encoder (-c:v) is present', () => {
    expect(() =>
      overrideFirstPassEncoderArgs(['-loglevel', 'error'], ['-c:v', 'libx264'])
    ).toThrow(/no output encoder/)
  })
})

describe('applyFirstPassEncoderArgs', () => {
  it('overrides the recorder config.firstPassArgs in place', () => {
    const recorder = {
      config: { firstPassArgs: [...BUILT_FIRST_PASS_ARGS] },
    }
    applyFirstPassEncoderArgs(
      recorder as never,
      resolveRecordingFirstPassArgs('sharp')
    )
    expect(argValue(recorder.config.firstPassArgs, '-preset')).toBe('veryfast')
    expect(argValue(recorder.config.firstPassArgs, '-tune')).toBe('stillimage')
    // Input decoder untouched.
    expect(recorder.config.firstPassArgs).toContain('image2pipe')
  })

  it('throws if the recorder no longer exposes config.firstPassArgs', () => {
    expect(() => applyFirstPassEncoderArgs({} as never, ['-c:v'])).toThrow(
      /did not expose config.firstPassArgs/
    )
    expect(() =>
      applyFirstPassEncoderArgs({ config: {} } as never, ['-c:v'])
    ).toThrow(/did not expose config.firstPassArgs/)
  })
})

describe('withActiveRecordingContext deferred overlay flush', () => {
  let dir: string
  let rasterCalls: number
  const page = {} as unknown as Page

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'screenci-video-flush-'))
    rasterCalls = 0
    setHtmlRasterizer(async () => {
      rasterCalls += 1
      return {
        buffer: Buffer.from(`png-${rasterCalls}`),
        width: 10,
        height: 10,
      }
    })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const imageRequest = () => ({
    kind: 'image' as const,
    name: 'ring',
    html: '<div>ring</div>',
    css: '',
    capturePadding: 0,
    deviceScaleFactor: 2,
  })

  it('rasterizes deferred overlays after a passing test body, before write', async () => {
    const recorder = new EventRecorder()
    recorder.start()
    const runtimeContext = createScreenCIRuntimeContext({
      recorder,
      page,
      recordingDir: dir,
    })

    await withActiveRecordingContext({
      runtimeContext,
      page,
      recorder,
      fn: async () => {
        recorder.addPendingAssetStart('ring', {
          kind: 'image',
          durationMs: 1000,
          fullScreen: false,
          request: imageRequest(),
        })
      },
    })

    expect(rasterCalls).toBe(1)
    const start = recorder.getEvents().find((e) => e.type === 'assetStart') as {
      path: string
      fileHash?: string
    }
    expect(start.path).not.toBe('')
    expect(start.fileHash).toBeDefined()
  })

  it('does not rasterize when the test body throws', async () => {
    const recorder = new EventRecorder()
    recorder.start()
    const runtimeContext = createScreenCIRuntimeContext({
      recorder,
      page,
      recordingDir: dir,
    })

    await expect(
      withActiveRecordingContext({
        runtimeContext,
        page,
        recorder,
        fn: async () => {
          recorder.addPendingAssetStart('ring', {
            kind: 'image',
            fullScreen: false,
            request: imageRequest(),
          })
          throw new Error('boom')
        },
      })
    ).rejects.toThrow('boom')

    expect(rasterCalls).toBe(0)
  })

  it('emits a textDeclare event when a declaration is provided', async () => {
    const recorder = new EventRecorder()
    recorder.start()
    const runtimeContext = createScreenCIRuntimeContext({
      recorder,
      page,
      recordingDir: dir,
    })

    await withActiveRecordingContext({
      runtimeContext,
      page,
      recorder,
      textDeclaration: {
        fields: ['heading'],
        studioFields: [],
        seed: { fi: { heading: 'Moi' } },
      },
      fn: async () => {},
    })

    expect(
      recorder.getEvents().filter((e) => e.type === 'textDeclare')
    ).toEqual([
      {
        type: 'textDeclare',
        timeMs: expect.any(Number),
        fields: ['heading'],
        studioFields: [],
        seed: { fi: { heading: 'Moi' } },
      },
    ])
  })

  it('emits no textDeclare event when no declaration is provided', async () => {
    const recorder = new EventRecorder()
    recorder.start()
    const runtimeContext = createScreenCIRuntimeContext({
      recorder,
      page,
      recordingDir: dir,
    })

    await withActiveRecordingContext({
      runtimeContext,
      page,
      recorder,
      fn: async () => {},
    })

    expect(recorder.getEvents().some((e) => e.type === 'textDeclare')).toBe(
      false
    )
  })

  it('is a no-op when no overlays were deferred', async () => {
    const recorder = new EventRecorder()
    recorder.start()
    const runtimeContext = createScreenCIRuntimeContext({
      recorder,
      page,
      recordingDir: dir,
    })

    await withActiveRecordingContext({
      runtimeContext,
      page,
      recorder,
      fn: async () => {},
    })

    expect(rasterCalls).toBe(0)
  })
})
