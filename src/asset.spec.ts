import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createOverlays,
  createStudioOverlays,
  setActiveAssetRecorder,
  setAssetSleepFn,
} from './asset.js'
import {
  setAnimatedHtmlRasterizer,
  setHtmlRasterizer,
} from './htmlRasterizer.js'
import type { Page } from '@playwright/test'
import { NOOP_EVENT_RECORDER, type IEventRecorder } from './events.js'
import type { RecordingEvent } from './events.js'
import {
  createScreenCIRuntimeContext,
  runWithScreenCIRuntimeContext,
} from './runtimeContext.js'

// The default placement every overlay resolves to when no fields are given.
const SCREEN = { relativeTo: 'screen', x: 0, y: 0, width: 1 } as const

function createMockRecorder(): IEventRecorder {
  return {
    start: vi.fn(),
    addInput: vi.fn(),
    addCueStart: vi.fn(),
    addStudioCueStart: vi.fn(),
    addCueEnd: vi.fn(),
    addVideoCueStart: vi.fn(),
    addAssetStart: vi.fn(),
    addAssetEnd: vi.fn(),
    addStudioAssetStart: vi.fn(),
    addHideStart: vi.fn(),
    addHideEnd: vi.fn(),
    addAutoZoomStart: vi.fn(),
    addAutoZoomEnd: vi.fn(),
    registerVoiceForLang: vi.fn(),
    getEvents: vi.fn<() => RecordingEvent[]>().mockReturnValue([]),
    writeToFile: vi
      .fn<(dir: string, videoName: string) => Promise<void>>()
      .mockResolvedValue(undefined),
  }
}

describe('createOverlays', () => {
  let recorder: IEventRecorder

  beforeEach(() => {
    recorder = createMockRecorder()
    setActiveAssetRecorder(recorder)
  })

  afterEach(() => {
    setActiveAssetRecorder(NOOP_EVENT_RECORDER)
  })

  it('creates a callable controller for each key in the map', () => {
    const overlays = createOverlays({
      logo: { path: './logo.png', durationMs: 1200 },
      intro: { path: './intro.mp4', fullScreen: true },
    })

    expect(overlays.logo).toBeDefined()
    expect(overlays.intro).toBeDefined()
    expect(typeof overlays.logo).toBe('function')
    expect(typeof overlays.intro).toBe('function')
  })

  describe('calling an overlay controller', () => {
    it('records an image start with the default full-screen placement', async () => {
      const overlays = createOverlays({
        logo: { path: './logo.png', durationMs: 1200 },
      })

      await overlays.logo()

      expect(recorder.addAssetStart).toHaveBeenCalledOnce()
      expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
        kind: 'image',
        path: './logo.png',
        durationMs: 1200,
        fullScreen: false,
        placement: SCREEN,
      })
    })

    it('accepts a bare string path', async () => {
      const overlays = createOverlays({ logo: './logo.png' })

      await overlays.logo(1000)

      expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
        kind: 'image',
        path: './logo.png',
        durationMs: 1000,
        fullScreen: false,
        placement: SCREEN,
      })
    })

    it('passes fullScreen as a fullScreen placement', async () => {
      const overlays = createOverlays({
        intro: { path: './intro.mp4', audio: 0.5, fullScreen: true },
      })

      await overlays.intro()

      expect(recorder.addAssetStart).toHaveBeenCalledWith('intro', {
        kind: 'video',
        path: './intro.mp4',
        audio: 0.5,
        fullScreen: true,
        placement: { fullScreen: true },
      })
    })

    it('passes non-zero audio value', async () => {
      const overlays = createOverlays({
        audio: { path: './sound.mp4', audio: 0.8 },
      })

      await overlays.audio()

      expect(recorder.addAssetStart).toHaveBeenCalledWith('audio', {
        kind: 'video',
        path: './sound.mp4',
        audio: 0.8,
        fullScreen: false,
        placement: SCREEN,
      })
    })

    it('defaults mp4 audio to 1 when omitted', async () => {
      const overlays = createOverlays({
        intro: { path: './intro.mp4', fullScreen: true },
      })

      await overlays.intro()

      expect(recorder.addAssetStart).toHaveBeenCalledWith('intro', {
        kind: 'video',
        path: './intro.mp4',
        audio: 1,
        fullScreen: true,
        placement: { fullScreen: true },
      })
    })

    it('resolves immediately', async () => {
      const overlays = createOverlays({
        clip: { path: './clip.mp4', fullScreen: true },
      })

      await expect(overlays.clip()).resolves.toBeUndefined()
    })

    it('each controller uses its own name and config', async () => {
      const overlays = createOverlays({
        logo: { path: './logo.png', durationMs: 1200 },
        intro: { path: './intro.mp4', fullScreen: true },
      })

      await overlays.logo()
      await overlays.intro()

      expect(recorder.addAssetStart).toHaveBeenCalledTimes(2)
      expect(recorder.addAssetStart).toHaveBeenNthCalledWith(1, 'logo', {
        kind: 'image',
        path: './logo.png',
        durationMs: 1200,
        fullScreen: false,
        placement: SCREEN,
      })
      expect(recorder.addAssetStart).toHaveBeenNthCalledWith(2, 'intro', {
        kind: 'video',
        path: './intro.mp4',
        audio: 1,
        fullScreen: true,
        placement: { fullScreen: true },
      })
    })

    it('fails when the overlay file is missing relative to the active test file', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'screenci-overlay-spec-'))
      const overlays = createOverlays({
        logo: { path: './missing.png', durationMs: 1200 },
      })

      try {
        await expect(
          runWithScreenCIRuntimeContext(
            createScreenCIRuntimeContext({
              recorder,
              testFilePath: join(tempDir, 'demo.video.ts'),
            }),
            () => overlays.logo()
          )
        ).rejects.toThrow('Asset file not found: ./missing.png')
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    })

    it('resolves overlay files relative to the active test file', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'screenci-overlay-spec-'))
      await writeFile(join(tempDir, 'logo.png'), 'logo')
      const overlays = createOverlays({
        logo: { path: './logo.png', durationMs: 1200 },
      })

      try {
        await runWithScreenCIRuntimeContext(
          createScreenCIRuntimeContext({
            recorder,
            testFilePath: join(tempDir, 'demo.video.ts'),
          }),
          () => overlays.logo()
        )

        expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
          kind: 'image',
          path: './logo.png',
          durationMs: 1200,
          fullScreen: false,
          placement: SCREEN,
        })
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    })

    it('blocking call without a duration throws (image with no durationMs)', async () => {
      const overlays = createOverlays({ logo: { path: './logo.png' } })

      await expect(overlays.logo()).rejects.toThrow(
        '[screenci] Overlay "logo" (./logo.png) needs a duration: pass one to the call (overlays.logo(1000)), set durationMs in the config, or drive it with .start()/.end().'
      )
    })

    it('uses the duration passed to the blocking call over the config', async () => {
      const overlays = createOverlays({
        logo: { path: './logo.png', durationMs: 1200 },
      })

      await overlays.logo(3000)

      expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
        kind: 'image',
        path: './logo.png',
        durationMs: 3000,
        fullScreen: false,
        placement: SCREEN,
      })
    })

    it('rejects a config durationMs that is not finite', () => {
      expect(() =>
        createOverlays({
          broken: { path: './logo.png', durationMs: Number.NaN },
        })
      ).toThrow(
        'Overlay "broken" (./logo.png) must provide a finite durationMs greater than or equal to 0.'
      )
    })

    it('rejects mp4 overlays with durationMs', () => {
      expect(() =>
        createOverlays({
          broken: { path: './clip.mp4', durationMs: 1000, audio: 0 } as never,
        })
      ).toThrow(
        'Overlay "broken" (./clip.mp4) is a video and must not provide durationMs. Its natural media duration is used instead.'
      )
    })

    it('rejects mp4 overlays with invalid audio when specified', () => {
      expect(() =>
        createOverlays({
          broken: { path: './clip.mp4', audio: Number.NaN },
        })
      ).toThrow(
        'Overlay "broken" (./clip.mp4) must provide a finite audio value between 0 and 1 for .mp4 overlays. Use audio: 0 for silent playback.'
      )
    })

    it('rejects image overlays with audio', () => {
      expect(() =>
        createOverlays({
          broken: { path: './logo.png', audio: 0.5 } as never,
        })
      ).toThrow(
        'Overlay "broken" (./logo.png) is an image and must not provide audio. Use durationMs instead.'
      )
    })

    it('rejects unsupported extensions', () => {
      expect(() =>
        createOverlays({
          broken: { path: './photo.webp' },
        })
      ).toThrow(
        'Overlay "broken" must use one of: .html, .svg, .png, .mp4. Received: ./photo.webp'
      )
    })

    it('rejects a config with both path and element', () => {
      expect(() =>
        createOverlays({
          broken: {
            path: './logo.png',
            element: createElement('div', null, 'x'),
          },
        })
      ).toThrow(
        'Overlay "broken" must provide only one of "path" or "element".'
      )
    })

    it('rejects a config with neither path nor element', () => {
      expect(() => createOverlays({ broken: { width: 0.2 } })).toThrow(
        'Overlay "broken" must provide a "path" or an "element".'
      )
    })
  })

  describe('placement', () => {
    it('accepts flat width-only placement fields and forwards them', async () => {
      const overlays = createOverlays({
        logo: {
          path: './logo.png',
          durationMs: 1000,
          relativeTo: 'screen',
          x: 0.1,
          y: 0.2,
          width: 0.3,
        },
      })

      await overlays.logo()

      expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
        kind: 'image',
        path: './logo.png',
        durationMs: 1000,
        fullScreen: false,
        placement: { relativeTo: 'screen', x: 0.1, y: 0.2, width: 0.3 },
      })
    })

    it('accepts a height-only placement', async () => {
      const overlays = createOverlays({
        logo: {
          path: './logo.png',
          durationMs: 1000,
          relativeTo: 'recording',
          height: 0.5,
        },
      })

      await overlays.logo()

      expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
        kind: 'image',
        path: './logo.png',
        durationMs: 1000,
        fullScreen: false,
        placement: { relativeTo: 'recording', x: 0, y: 0, height: 0.5 },
      })
    })

    it('defaults to full-screen-width placement when no fields are given', async () => {
      const overlays = createOverlays({
        logo: { path: './logo.png', durationMs: 1000 },
      })

      await overlays.logo()

      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'logo',
        expect.objectContaining({ placement: SCREEN })
      )
    })

    it('rejects setting both width and height', () => {
      expect(() =>
        createOverlays({
          logo: {
            path: './logo.png',
            durationMs: 1000,
            width: 0.3,
            height: 0.3,
          },
        })
      ).toThrow(
        'Overlay "logo" must set only one of width or height (the other is derived from the aspect ratio).'
      )
    })

    it('rejects out-of-range coordinates', () => {
      expect(() =>
        createOverlays({
          logo: { path: './logo.png', durationMs: 1000, x: 1.5, width: 0.3 },
        })
      ).toThrow(
        'Overlay "logo" x must be a number between 0 and 1 (normalized fraction). Received: 1.5'
      )
    })

    it('rejects an invalid relativeTo', () => {
      expect(() =>
        createOverlays({
          logo: {
            path: './logo.png',
            durationMs: 1000,
            relativeTo: 'viewport' as never,
            width: 0.3,
          },
        })
      ).toThrow("Overlay \"logo\" relativeTo must be 'screen' or 'recording'.")
    })
  })

  describe('control flow (blocking vs start/end)', () => {
    beforeEach(() => {
      setAssetSleepFn(() => {})
    })

    afterEach(() => {
      setAssetSleepFn((ms: number) => {
        const end = performance.now() + ms
        while (performance.now() < end) {
          /* restore default spin */
        }
      })
    })

    it('blocking call records only assetStart with a duration', async () => {
      const overlays = createOverlays({
        logo: { path: './logo.png', durationMs: 1000 },
      })

      await overlays.logo(1500)

      expect(recorder.addAssetStart).toHaveBeenCalledOnce()
      expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
        kind: 'image',
        path: './logo.png',
        durationMs: 1500,
        fullScreen: false,
        placement: SCREEN,
      })
      expect(recorder.addAssetEnd).not.toHaveBeenCalled()
    })

    it('start() then end() records a live assetStart (no duration) and an assetEnd', async () => {
      const overlays = createOverlays({ badge: { path: './badge.png' } })

      await overlays.badge.start()
      expect(recorder.addAssetStart).toHaveBeenCalledWith('badge', {
        kind: 'image',
        path: './badge.png',
        fullScreen: false,
        placement: SCREEN,
      })

      await overlays.badge.end()
      expect(recorder.addAssetEnd).toHaveBeenCalledWith('wait')
    })

    it('starting a second overlay auto-ends the first and warns', async () => {
      const warnSpy = vi
        .spyOn(await import('./logger.js').then((m) => m.logger), 'warn')
        .mockImplementation(() => {})
      const overlays = createOverlays({
        a: { path: './a.png' },
        b: { path: './b.png' },
      })

      await overlays.a.start()
      await overlays.b.start()

      expect(recorder.addAssetEnd).toHaveBeenCalledWith('auto')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Overlay "a" was started with .start() and auto-ended'
        )
      )
      warnSpy.mockRestore()
    })

    it('blocking call auto-ends a previously started live overlay', async () => {
      const overlays = createOverlays({
        a: { path: './a.png' },
        b: { path: './b.png', durationMs: 800 },
      })

      await overlays.a.start()
      await overlays.b()

      expect(recorder.addAssetEnd).toHaveBeenCalledWith('auto')
      expect(recorder.addAssetStart).toHaveBeenLastCalledWith('b', {
        kind: 'image',
        path: './b.png',
        durationMs: 800,
        fullScreen: false,
        placement: SCREEN,
      })
    })

    it('end() without an active overlay throws', async () => {
      const overlays = createOverlays({ a: { path: './a.png' } })

      await expect(overlays.a.end()).rejects.toThrow(
        'Cannot call end() for overlay "a" because it is not the active started overlay'
      )
    })
  })

  describe('HTML file and React element overlays', () => {
    let dir: string
    const fakePage = {} as unknown as Page

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'screenci-rendered-overlay-'))
      setHtmlRasterizer(async () => ({
        buffer: Buffer.from('png'),
        width: 200,
        height: 50,
      }))
    })

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true })
    })

    it('reads an .html file and records an image start with the generated png', async () => {
      await writeFile(join(dir, 'hint.html'), '<div>Click</div>')
      const overlays = createOverlays({
        hint: {
          path: './hint.html',
          durationMs: 1500,
          x: 0.1,
          y: 0.1,
          width: 0.3,
        },
      })

      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          page: fakePage,
          recordingDir: dir,
          testFilePath: join(dir, 'demo.video.ts'),
        }),
        () => overlays.hint()
      )

      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'hint',
        expect.objectContaining({
          kind: 'image',
          durationMs: 1500,
          fullScreen: false,
          placement: { relativeTo: 'screen', x: 0.1, y: 0.1, width: 0.3 },
        })
      )
      const payload = vi.mocked(recorder.addAssetStart).mock.calls[0]![1] as {
        path: string
        fileHash?: string
      }
      expect(payload.path.endsWith('.png')).toBe(true)
      expect(payload.fileHash).toBeDefined()
    })

    it('renders a React element to an image overlay', async () => {
      const overlays = createOverlays({
        badge: { element: createElement('div', null, 'New'), durationMs: 1200 },
      })

      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          page: fakePage,
          recordingDir: dir,
        }),
        () => overlays.badge()
      )

      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'badge',
        expect.objectContaining({
          kind: 'image',
          durationMs: 1200,
          placement: SCREEN,
        })
      )
    })

    it('accepts a bare React element with default placement', async () => {
      const overlays = createOverlays({
        badge: createElement('span', null, 'hi'),
      })

      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          page: fakePage,
          recordingDir: dir,
        }),
        () => overlays.badge.start()
      )

      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'badge',
        expect.objectContaining({ kind: 'image', placement: SCREEN })
      )
    })

    it('renders Playwright JSX nodes (.video.tsx files) by invoking components', async () => {
      // Playwright transpiles JSX in .video.tsx files with its own automatic
      // runtime, producing `__pw_type` nodes instead of React elements, and a
      // component's body is pw-jsx too. Simulate that shape.
      const Badge = (props: { label: string }) => ({
        __pw_type: 'jsx',
        type: 'div',
        props: { className: 'badge', children: props.label },
        key: null,
      })
      const pwElement = {
        __pw_type: 'jsx',
        type: Badge,
        props: { label: 'New' },
        key: null,
      }

      let captured: string | undefined
      setHtmlRasterizer(async (req) => {
        captured = req.html
        return { buffer: Buffer.from('png'), width: 200, height: 50 }
      })

      const overlays = createOverlays({
        badge: { element: pwElement, durationMs: 1000 },
      })

      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          page: fakePage,
          recordingDir: dir,
        }),
        () => overlays.badge()
      )

      expect(captured).toBe('<div class="badge">New</div>')
      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'badge',
        expect.objectContaining({ kind: 'image', placement: SCREEN })
      )
    })

    it('detects a bare Playwright JSX node as an element', async () => {
      const pwElement = {
        __pw_type: 'jsx',
        type: 'span',
        props: { children: 'hi' },
        key: null,
      }

      let captured: string | undefined
      setHtmlRasterizer(async (req) => {
        captured = req.html
        return { buffer: Buffer.from('png'), width: 50, height: 20 }
      })

      const overlays = createOverlays({ badge: pwElement })

      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          page: fakePage,
          recordingDir: dir,
        }),
        () => overlays.badge.start()
      )

      expect(captured).toBe('<span>hi</span>')
      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'badge',
        expect.objectContaining({ kind: 'image', placement: SCREEN })
      )
    })

    it('is a no-op outside an active recording (no page / recording dir)', async () => {
      const overlays = createOverlays({
        hint: { path: './hint.html', durationMs: 1000 },
      })

      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          page: null,
          recordingDir: null,
        }),
        () => overlays.hint()
      )

      expect(recorder.addAssetStart).not.toHaveBeenCalled()
    })
  })

  describe('animated overlays', () => {
    let dir: string
    const fakePage = {} as unknown as Page

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'screenci-animated-overlay-'))
      setAnimatedHtmlRasterizer(async () => ({
        buffer: Buffer.from('mp4'),
        width: 320,
        height: 80,
      }))
    })

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true })
    })

    const run = (fn: () => Promise<void>) =>
      runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          page: fakePage,
          recordingDir: dir,
          testFilePath: join(dir, 'demo.video.ts'),
        }),
        fn
      )

    it('records an animation start with the config duration (blocking)', async () => {
      const overlays = createOverlays({
        intro: {
          element: createElement('div', null, 'hi'),
          animate: true,
          durationMs: 1500,
        },
      })

      await run(() => overlays.intro())

      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'intro',
        expect.objectContaining({
          kind: 'animation',
          durationMs: 1500,
          fullScreen: false,
          placement: SCREEN,
        })
      )
      const payload = vi.mocked(recorder.addAssetStart).mock.calls[0]![1] as {
        path: string
        fileHash?: string
      }
      expect(payload.path.endsWith('.mp4')).toBe(true)
      expect(payload.fileHash).toBeDefined()
    })

    it('uses the blocking call argument as the capture duration', async () => {
      const overlays = createOverlays({
        intro: { element: createElement('div', null, 'hi'), animate: true },
      })

      await run(() => overlays.intro(800))

      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'intro',
        expect.objectContaining({ kind: 'animation', durationMs: 800 })
      )
    })

    it('cuts the capture time from the recording (wraps capture in a hide)', async () => {
      const overlays = createOverlays({
        intro: {
          element: createElement('div', null, 'hi'),
          animate: true,
          durationMs: 1500,
        },
      })

      await run(() => overlays.intro())

      // The slow frame capture is bracketed by hideStart/hideEnd so its
      // wall-clock is cut from the output, and the asset start is recorded
      // after the capture finishes.
      expect(recorder.addHideStart).toHaveBeenCalledOnce()
      expect(recorder.addHideEnd).toHaveBeenCalledOnce()
      const hideStart = vi.mocked(recorder.addHideStart).mock
        .invocationCallOrder[0]!
      const hideEnd = vi.mocked(recorder.addHideEnd).mock
        .invocationCallOrder[0]!
      const assetStart = vi.mocked(recorder.addAssetStart).mock
        .invocationCallOrder[0]!
      expect(hideStart).toBeLessThan(hideEnd)
      expect(hideEnd).toBeLessThanOrEqual(assetStart)
    })

    it('animates an .html file overlay', async () => {
      await writeFile(join(dir, 'intro.html'), '<div class="fade">hi</div>')
      const overlays = createOverlays({
        intro: { path: './intro.html', animate: true, durationMs: 1000 },
      })

      await run(() => overlays.intro())

      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'intro',
        expect.objectContaining({ kind: 'animation', durationMs: 1000 })
      )
    })

    it('omits durationMs for a live start()/end()-driven animation', async () => {
      const overlays = createOverlays({
        badge: {
          element: createElement('div', null, 'hi'),
          animate: true,
          durationMs: 1000,
        },
      })

      await run(() => overlays.badge.start())

      const payload = vi.mocked(recorder.addAssetStart).mock.calls[0]![1] as {
        kind: string
        durationMs?: number
      }
      expect(payload.kind).toBe('animation')
      expect(payload.durationMs).toBeUndefined()
    })

    it('throws when driven with start() and no config duration', async () => {
      const overlays = createOverlays({
        badge: { element: createElement('div', null, 'hi'), animate: true },
      })

      await expect(run(() => overlays.badge.start())).rejects.toThrow(
        'needs durationMs in its config'
      )
    })

    it('throws when called blocking with no duration anywhere', async () => {
      const overlays = createOverlays({
        intro: { element: createElement('div', null, 'hi'), animate: true },
      })

      await expect(run(() => overlays.intro())).rejects.toThrow(
        'needs a duration'
      )
    })

    it('rejects animate on a non-HTML file overlay', () => {
      expect(() =>
        createOverlays({
          logo: { path: './logo.png', animate: true, durationMs: 1000 },
        })
      ).toThrow('only supported for HTML files and React elements')
    })

    it('rejects fps without animate', () => {
      expect(() =>
        createOverlays({
          logo: { path: './logo.png', fps: 30, durationMs: 1000 },
        })
      ).toThrow('only applies to animated overlays')
    })

    it('passes css and capturePadding to the animated rasterizer', async () => {
      let captured: { css?: string; capturePadding?: number } | undefined
      setAnimatedHtmlRasterizer(async (request) => {
        captured = {
          css: request.css,
          capturePadding: request.capturePadding,
        }
        return { buffer: Buffer.from('mp4'), width: 320, height: 80 }
      })
      const overlays = createOverlays({
        intro: {
          element: createElement('div', null, 'hi'),
          animate: true,
          durationMs: 1000,
          css: '.card{color:red}',
          capturePadding: 80,
        },
      })

      await run(() => overlays.intro())

      expect(captured?.css).toBe('.card{color:red}')
      expect(captured?.capturePadding).toBe(80)
    })

    it('rejects css/capturePadding on a non-HTML file overlay', () => {
      expect(() =>
        createOverlays({
          logo: { path: './logo.png', css: '.a{}', durationMs: 1000 },
        })
      ).toThrow('only supported for HTML files and React elements')
    })

    it('rejects a negative capturePadding', () => {
      expect(() =>
        createOverlays({
          intro: {
            element: createElement('div', null, 'hi'),
            animate: true,
            durationMs: 1000,
            capturePadding: -5,
          },
        })
      ).toThrow('capturePadding')
    })
  })

  describe('with the default no-op recorder', () => {
    beforeEach(() => setActiveAssetRecorder(NOOP_EVENT_RECORDER))

    it('calling the controller is a no-op', async () => {
      const overlays = createOverlays({
        logo: { path: './logo.png', durationMs: 1200 },
      })

      await expect(overlays.logo()).resolves.toBeUndefined()
      expect(recorder.addAssetStart).not.toHaveBeenCalled()
    })
  })
})

describe('createStudioOverlays', () => {
  let recorder: IEventRecorder

  beforeEach(() => {
    recorder = createMockRecorder()
    setActiveAssetRecorder(recorder)
  })

  afterEach(() => {
    setActiveAssetRecorder(NOOP_EVENT_RECORDER)
  })

  it('creates a callable controller for each key', () => {
    const overlays = createStudioOverlays('intro', 'logo')

    expect(typeof overlays.intro).toBe('function')
    expect(typeof overlays.logo).toBe('function')
  })

  it('records a studio asset start with the key name', async () => {
    const overlays = createStudioOverlays('intro', 'logo')

    await overlays.intro()
    await overlays.logo()

    expect(recorder.addStudioAssetStart).toHaveBeenCalledTimes(2)
    expect(recorder.addStudioAssetStart).toHaveBeenNthCalledWith(1, 'intro')
    expect(recorder.addStudioAssetStart).toHaveBeenNthCalledWith(2, 'logo')
    expect(recorder.addAssetStart).not.toHaveBeenCalled()
  })

  it('resolves immediately', async () => {
    const overlays = createStudioOverlays('intro')

    await expect(overlays.intro()).resolves.toBeUndefined()
  })

  it('throws on duplicate keys', () => {
    expect(() => createStudioOverlays('intro', 'intro')).toThrow(
      'Duplicate overlay key "intro" passed to createStudioOverlays. Overlay keys must be unique.'
    )
  })

  it('does not require the overlay file to exist locally', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'screenci-studio-overlay-'))
    const overlays = createStudioOverlays('intro')

    try {
      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          testFilePath: join(tempDir, 'demo.video.ts'),
        }),
        () => overlays.intro()
      )

      expect(recorder.addStudioAssetStart).toHaveBeenCalledWith('intro')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
