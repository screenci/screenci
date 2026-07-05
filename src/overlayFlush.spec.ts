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
})
