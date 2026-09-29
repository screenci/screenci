import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { EventRecorder, NOOP_EVENT_RECORDER } from './events.js'
import type {
  DeferredRasterizeRequest,
  ImageAssetStartEvent,
} from './events.js'
import { flushPendingOverlays } from './overlayFlush.js'
import {
  setHtmlRasterizer,
  setAnimatedHtmlRasterizer,
} from './htmlRasterizer.js'
import {
  createScreenCIRuntimeContext,
  runWithScreenCIRuntimeContext,
} from './runtimeContext.js'

const imageRequest = (html: string): DeferredRasterizeRequest => ({
  kind: 'image',
  name: 'ov',
  html,
  deviceScaleFactor: 2,
})

const animationRequest = (html: string): DeferredRasterizeRequest => ({
  kind: 'animation',
  name: 'ov',
  html,
  deviceScaleFactor: 2,
  fps: 30,
  durationMs: 1000,
})

describe('flushPendingOverlays', () => {
  let dir: string
  let imageCalls: number
  let animationCalls: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'screenci-flush-'))
    imageCalls = 0
    animationCalls = 0
    setHtmlRasterizer(async () => {
      imageCalls += 1
      return { buffer: Buffer.from(`png-${imageCalls}`), width: 10, height: 10 }
    })
    setAnimatedHtmlRasterizer(async () => {
      animationCalls += 1
      return {
        buffer: Buffer.from(`mp4-${animationCalls}`),
        width: 10,
        height: 10,
      }
    })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const withRecording = <T>(fn: () => Promise<T>): Promise<T> =>
    runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ recordingDir: dir }),
      fn
    )

  const pendingEvents = (recorder: EventRecorder): ImageAssetStartEvent[] =>
    recorder
      .getEvents()
      .filter((e): e is ImageAssetStartEvent => e.type === 'assetStart')

  it('does nothing when there are no pending overlays', async () => {
    const recorder = new EventRecorder()
    recorder.start()
    await withRecording(() => flushPendingOverlays(recorder))
    expect(imageCalls).toBe(0)
    expect(animationCalls).toBe(0)
  })

  it('is a no-op for the no-op recorder', async () => {
    await withRecording(() => flushPendingOverlays(NOOP_EVENT_RECORDER))
    expect(imageCalls).toBe(0)
  })

  it('rasterizes identical markup once and patches both events alike', async () => {
    const recorder = new EventRecorder()
    recorder.start()
    recorder.addPendingAssetStart('a', {
      kind: 'image',
      durationMs: 1000,
      fullScreen: false,
      request: imageRequest('<div>same</div>'),
    })
    recorder.addPendingAssetStart('b', {
      kind: 'image',
      durationMs: 1000,
      fullScreen: false,
      request: imageRequest('<div>same</div>'),
    })

    await withRecording(() => flushPendingOverlays(recorder))

    expect(imageCalls).toBe(1)
    const events = pendingEvents(recorder)
    expect(events).toHaveLength(2)
    expect(events[0]!.path).not.toBe('')
    expect(events[0]!.path).toBe(events[1]!.path)
    expect(events[0]!.fileHash).toBe(events[1]!.fileHash)
    expect(events[0]!.fileHash).toBeDefined()
  })

  it('rasterizes differing markup separately', async () => {
    const recorder = new EventRecorder()
    recorder.start()
    recorder.addPendingAssetStart('a', {
      kind: 'image',
      fullScreen: false,
      request: imageRequest('<div>a</div>'),
    })
    recorder.addPendingAssetStart('b', {
      kind: 'image',
      fullScreen: false,
      request: imageRequest('<div>b</div>'),
    })

    await withRecording(() => flushPendingOverlays(recorder))

    expect(imageCalls).toBe(2)
    const events = pendingEvents(recorder)
    expect(events[0]!.path).not.toBe(events[1]!.path)
  })

  it('passes the overlay document through to the rasterizer', async () => {
    let seen: string | undefined
    setHtmlRasterizer(async (request) => {
      seen = request.html
      return { buffer: Buffer.from('png'), width: 10, height: 10 }
    })
    const recorder = new EventRecorder()
    recorder.start()
    recorder.addPendingAssetStart('ov', {
      kind: 'image',
      fullScreen: false,
      request: imageRequest('<div>doc</div>'),
    })

    await withRecording(() => flushPendingOverlays(recorder))

    expect(seen).toBe('<div>doc</div>')
  })

  it('patches an animation event with its alpha-capable preview clip', async () => {
    setAnimatedHtmlRasterizer(async () => ({
      buffer: Buffer.from('mp4'),
      previewBuffer: Buffer.from('webm'),
      width: 10,
      height: 10,
    }))
    const recorder = new EventRecorder()
    recorder.start()
    recorder.addPendingAssetStart('anim', {
      kind: 'animation',
      durationMs: 1000,
      fullScreen: false,
      request: animationRequest('<div>x</div>'),
    })

    await withRecording(() => flushPendingOverlays(recorder))

    const [event] = pendingEvents(recorder)
    expect(event).toMatchObject({ kind: 'animation' })
    const anim = event as unknown as {
      previewPath?: string
      previewFileHash?: string
    }
    expect(anim.previewPath?.endsWith('.webm')).toBe(true)
    expect(anim.previewFileHash).toBeDefined()
  })

  it('keys image and animation requests separately', async () => {
    const recorder = new EventRecorder()
    recorder.start()
    recorder.addPendingAssetStart('img', {
      kind: 'image',
      fullScreen: false,
      request: imageRequest('<div>x</div>'),
    })
    recorder.addPendingAssetStart('anim', {
      kind: 'animation',
      durationMs: 1000,
      fullScreen: false,
      request: animationRequest('<div>x</div>'),
    })

    await withRecording(() => flushPendingOverlays(recorder))

    expect(imageCalls).toBe(1)
    expect(animationCalls).toBe(1)
    const events = pendingEvents(recorder)
    expect(events[0]!.path.endsWith('.png')).toBe(true)
    expect(events[1]!.path.endsWith('.mp4')).toBe(true)
  })

  describe('anchored overlays', () => {
    const spec = {
      element: { x: 400, y: 250, width: 200, height: 100 },
      viewport: { width: 1000, height: 600 },
      side: 'bottom' as const,
      align: 'center' as const,
      gap: 10,
      margin: 0,
      bleed: 8,
      flip: true,
      keepInViewport: true,
    }

    it('places the captured content beside the element and records the anchor provenance', async () => {
      // Root = content 120x40 plus 8px bleed on every side.
      setHtmlRasterizer(async () => {
        imageCalls += 1
        return { buffer: Buffer.from('png'), width: 136, height: 56 }
      })
      const recorder = new EventRecorder()
      recorder.start()
      recorder.addPendingAssetStart('hint', {
        kind: 'image',
        durationMs: 1000,
        fullScreen: false,
        placement: { relativeTo: 'recording', x: 400, y: 250, width: 200 },
        request: { ...imageRequest('<div>hint</div>'), anchor: { spec } },
      })

      await withRecording(() => flushPendingOverlays(recorder))

      expect(imageCalls).toBe(1)
      const [event] = pendingEvents(recorder)
      // Content centred below the element (x 440, y 360), box inflated by 8.
      expect(event!.placement).toEqual({
        relativeTo: 'recording',
        x: 432,
        y: 352,
        width: 136,
        aspectRatio: 136 / 56,
        anchorSide: 'bottom',
        anchorAlign: 'center',
        anchorGapPx: 10,
        bleedPx: 8,
      })
      expect(event!.path).not.toBe('')
    })

    it('rasterizes the flipped document when the overlay flips and places that one', async () => {
      const sizes: Record<string, { width: number; height: number }> = {
        '<div class="below">hint</div>': { width: 136, height: 56 },
        '<div class="above">hint</div>': { width: 156, height: 76 },
      }
      const seen: string[] = []
      setHtmlRasterizer(async (request) => {
        seen.push(request.html)
        const size = sizes[request.html]
        if (size === undefined)
          throw new Error(`unexpected html ${request.html}`)
        return { buffer: Buffer.from(request.html), ...size }
      })
      const recorder = new EventRecorder()
      recorder.start()
      recorder.addPendingAssetStart('hint', {
        kind: 'image',
        durationMs: 1000,
        fullScreen: false,
        placement: { relativeTo: 'recording', x: 400, y: 560, width: 200 },
        request: {
          ...imageRequest('<div class="below">hint</div>'),
          anchor: {
            // The element sits at the bottom edge: below does not fit.
            spec: { ...spec, element: { ...spec.element, y: 560 } },
            htmlFlipped: '<div class="above">hint</div>',
          },
        },
      })

      await withRecording(() => flushPendingOverlays(recorder))

      expect(seen).toEqual([
        '<div class="below">hint</div>',
        '<div class="above">hint</div>',
      ])
      const [event] = pendingEvents(recorder)
      // Flipped content is 140x60; it sits 10px above the element (y 560),
      // centred on it (x 430), and the box adds the 8px bleed.
      expect(event!.placement).toEqual({
        relativeTo: 'recording',
        x: 422,
        y: 560 - 10 - 60 - 8,
        width: 156,
        aspectRatio: 156 / 76,
        anchorSide: 'top',
        anchorAlign: 'center',
        anchorGapPx: 10,
        bleedPx: 8,
      })
    })

    it('keeps the requested side when the overlay flips but has no flipped document', async () => {
      setHtmlRasterizer(async () => ({
        buffer: Buffer.from('png'),
        width: 136,
        height: 56,
      }))
      const recorder = new EventRecorder()
      recorder.start()
      recorder.addPendingAssetStart('hint', {
        kind: 'image',
        durationMs: 1000,
        fullScreen: false,
        placement: { relativeTo: 'recording', x: 400, y: 560, width: 200 },
        request: {
          ...imageRequest('<div>hint</div>'),
          anchor: { spec: { ...spec, element: { ...spec.element, y: 560 } } },
        },
      })

      await withRecording(() => flushPendingOverlays(recorder))

      const [event] = pendingEvents(recorder)
      expect(event!.placement).toMatchObject({
        anchorSide: 'top',
        y: 560 - 10 - 40 - 8,
      })
    })
  })
})
