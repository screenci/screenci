import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import {
  createOverlays,
  buildStudioOverlays,
  selected,
  setActiveAssetRecorder,
  setAssetSleepFn,
  validateRegisteredAssetPaths,
  resetRegisteredAssetPaths,
} from './asset.js'
import {
  setAnimatedHtmlRasterizer,
  setHtmlRasterizer,
} from './htmlRasterizer.js'
import type { Locator, Page } from '@playwright/test'
import { NOOP_EVENT_RECORDER, type IEventRecorder } from './events.js'
import type { RecordingEvent } from './events.js'
import {
  createScreenCIRuntimeContext,
  runWithScreenCIRuntimeContext,
} from './runtimeContext.js'

/** A minimal Locator stand-in exposing the box + viewport overlayRect reads. */
function fakeLocator(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number }
): Locator {
  const page = { viewportSize: () => viewport }
  return {
    boundingBox: async () => box,
    page: () => page,
  } as unknown as Locator
}

function createMockRecorder(): IEventRecorder {
  return {
    start: vi.fn(),
    addInput: vi.fn(),
    addCueStart: vi.fn(),
    addStudioCueStart: vi.fn(),
    addCueEnd: vi.fn(),
    addVideoCueStart: vi.fn(),
    addAssetStart: vi.fn(),
    addPendingAssetStart: vi.fn(),
    getPendingOverlays: vi.fn().mockReturnValue([]),
    addAssetEnd: vi.fn(),
    addStudioAssetStart: vi.fn(),
    addAudioStart: vi.fn(),
    addAudioEnd: vi.fn(),
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
      intro: { path: './intro.mp4', fill: 'screen' },
    })

    expect(overlays.logo).toBeDefined()
    expect(overlays.intro).toBeDefined()
    expect(typeof overlays.logo).toBe('function')
    expect(typeof overlays.intro).toBe('function')
  })

  describe('calling an overlay controller', () => {
    it('records an image start with the default recording placement', async () => {
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
      })
    })

    it('records an absolute string position as an outputMs anchor', async () => {
      const overlays = createOverlays({ logo: { path: './logo.png' } })

      await overlays.logo('0:10')

      expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
        kind: 'image',
        path: './logo.png',
        untilOutputMs: 10000,
        fullScreen: false,
      })
    })

    it('records a percentage string position as a percent anchor', async () => {
      const overlays = createOverlays({ logo: { path: './logo.png' } })

      await overlays.logo('56%')

      expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
        kind: 'image',
        path: './logo.png',
        untilPercent: 0.56,
        fullScreen: false,
      })
    })

    it('rejects a string position on a video overlay', async () => {
      const overlays = createOverlays({ clip: { path: './clip.mp4' } })

      await expect(overlays.clip('0:10')).rejects.toThrow(
        /is a video and cannot use a string position/
      )
    })

    it('accepts a bare string path', async () => {
      const overlays = createOverlays({ logo: './logo.png' })

      await overlays.logo(1000)

      expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
        kind: 'image',
        path: './logo.png',
        durationMs: 1000,
        fullScreen: false,
      })
    })

    it('passes fill: screen as a fullScreen placement', async () => {
      const overlays = createOverlays({
        intro: { path: './intro.mp4', volume: 0.5, fill: 'screen' },
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

    it('passes non-zero volume value', async () => {
      const overlays = createOverlays({
        audio: { path: './sound.mp4', volume: 0.8 },
      })

      await overlays.audio()

      expect(recorder.addAssetStart).toHaveBeenCalledWith('audio', {
        kind: 'video',
        path: './sound.mp4',
        audio: 0.8,
        fullScreen: false,
      })
    })

    it('defaults mp4 audio to 1 (natural level) when omitted', async () => {
      const overlays = createOverlays({
        intro: { path: './intro.mp4', fill: 'screen' },
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
        clip: { path: './clip.mp4', fill: 'screen' },
      })

      await expect(overlays.clip()).resolves.toBeUndefined()
    })

    it('each controller uses its own name and config', async () => {
      const overlays = createOverlays({
        logo: { path: './logo.png', durationMs: 1200 },
        intro: { path: './intro.mp4', fill: 'screen' },
      })

      await overlays.logo()
      await overlays.intro()

      expect(recorder.addAssetStart).toHaveBeenCalledTimes(2)
      expect(recorder.addAssetStart).toHaveBeenNthCalledWith(1, 'logo', {
        kind: 'image',
        path: './logo.png',
        durationMs: 1200,
        fullScreen: false,
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
              testFilePath: join(tempDir, 'demo.screenci.ts'),
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
            testFilePath: join(tempDir, 'demo.screenci.ts'),
          }),
          () => overlays.logo()
        )

        expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
          kind: 'image',
          path: './logo.png',
          durationMs: 1200,
          fullScreen: false,
        })
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    })

    it('blocking call without a duration throws (image with no durationMs)', async () => {
      const overlays = createOverlays({ logo: { path: './logo.png' } })

      await expect(overlays.logo()).rejects.toThrow(
        '[screenci] Overlay "logo" (./logo.png) needs a duration: pass one to the call (overlays.logo(1000)), a string position (overlays.logo(\'0:05\')), set durationMs in the config, or drive it with .start()/.end().'
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
          broken: { path: './clip.mp4', durationMs: 1000, volume: 0 } as never,
        })
      ).toThrow(
        'Overlay "broken" (./clip.mp4) is a video and must not provide durationMs. Its natural media duration is used instead.'
      )
    })

    it('rejects mp4 overlays with invalid volume when specified', () => {
      expect(() =>
        createOverlays({
          broken: { path: './clip.mp4', volume: Number.NaN },
        })
      ).toThrow(
        'Overlay "broken" (./clip.mp4) must provide a finite volume between 0 and 4 for .mp4 overlays. 1 is the natural level, 0 is silent, and values above 1 boost it.'
      )
    })

    it('rejects image overlays with volume', () => {
      expect(() =>
        createOverlays({
          broken: { path: './logo.png', volume: 0.5 } as never,
        })
      ).toThrow(
        'Overlay "broken" (./logo.png) is an image and must not provide volume. Use durationMs instead.'
      )
    })

    it('passes speed for an mp4 overlay', async () => {
      const overlays = createOverlays({
        clip: { path: './clip.mp4', fill: 'screen', speed: 2 },
      })

      await overlays.clip()

      expect(recorder.addAssetStart).toHaveBeenCalledWith('clip', {
        kind: 'video',
        path: './clip.mp4',
        audio: 1,
        fullScreen: true,
        placement: { fullScreen: true },
        speed: 2,
      })
    })

    it('passes time for an mp4 overlay', async () => {
      const overlays = createOverlays({
        clip: { path: './clip.mp4', fill: 'screen', time: 3000 },
      })

      await overlays.clip()

      expect(recorder.addAssetStart).toHaveBeenCalledWith('clip', {
        kind: 'video',
        path: './clip.mp4',
        audio: 1,
        fullScreen: true,
        placement: { fullScreen: true },
        time: 3000,
      })
    })

    it('rejects mp4 overlays with both speed and time', () => {
      expect(() =>
        createOverlays({
          broken: { path: './clip.mp4', speed: 2, time: 3000 },
        })
      ).toThrow(
        'Overlay "broken" (./clip.mp4) must set only one of speed or time, not both.'
      )
    })

    it('rejects mp4 overlays with a non-positive speed', () => {
      expect(() =>
        createOverlays({
          broken: { path: './clip.mp4', speed: 0 },
        })
      ).toThrow(/must provide a finite speed greater than 0/)
    })

    it('rejects speed/time on a non-video overlay', () => {
      expect(() =>
        createOverlays({
          broken: { path: './logo.png', durationMs: 1000, speed: 2 } as never,
        })
      ).toThrow(
        'Overlay "broken" only supports speed/time on .mp4 video overlays.'
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
          } as never,
        })
      ).toThrow(
        'Overlay "broken" must provide only one of "path", "element", or "html".'
      )
    })

    it('rejects a config with both path and html', () => {
      expect(() =>
        createOverlays({
          broken: { path: './logo.png', html: '<div>x</div>' } as never,
        })
      ).toThrow(
        'Overlay "broken" must provide only one of "path", "element", or "html".'
      )
    })

    it('rejects a config with both element and html', () => {
      expect(() =>
        createOverlays({
          broken: {
            element: createElement('div', null, 'x'),
            html: '<div>x</div>',
          } as never,
        })
      ).toThrow(
        'Overlay "broken" must provide only one of "path", "element", or "html".'
      )
    })

    it('rejects a config with no content source', () => {
      expect(() => createOverlays({ broken: { width: 200 } as never })).toThrow(
        'Overlay "broken" must provide a "path", an "element", or inline "html".'
      )
    })

    it('rejects empty inline html', () => {
      expect(() =>
        createOverlays({ broken: { html: '   ', durationMs: 1000 } })
      ).toThrow('Overlay "broken" inline "html" must not be empty.')
    })

    it.each(['<!doctype html>', '<html>', '<HEAD>', '<body class="x">'])(
      'rejects inline html containing the document tag %s',
      (markup) => {
        expect(() =>
          createOverlays({
            broken: { html: `${markup}<div>x</div>`, durationMs: 1000 },
          })
        ).toThrow('must be a fragment, not a full HTML document')
      }
    )

    it.each([
      ['two sibling elements', '<div>a</div><div>b</div>'],
      ['two void siblings', '<br><br>'],
      ['element then text', '<div>a</div>tail'],
      ['text then element', 'lead<div>a</div>'],
      ['bare text only', 'just text'],
    ])('rejects inline html with %s', (_label, markup) => {
      expect(() =>
        createOverlays({ broken: { html: markup, durationMs: 1000 } })
      ).toThrow('must contain a single root element')
    })

    it.each([
      ['a single element', '<div class="note">Tip</div>'],
      ['a single element with nested children', '<div><span>a</span> b</div>'],
      ['a single void element', '<img src="x.png" />'],
      ['a single element with > inside text', '<div>1 > 0</div>'],
      [
        'a single element with > inside an attribute',
        '<div data-q="a>b">c</div>',
      ],
      ['a single element with a comment sibling', '<!-- note --><div>a</div>'],
      ['surrounding whitespace', '   <div>a</div>   '],
    ])('accepts inline html with %s', (_label, markup) => {
      expect(() =>
        createOverlays({ ok: { html: markup, durationMs: 1000 } })
      ).not.toThrow()
    })
  })

  describe('placement', () => {
    it('accepts flat width-only placement fields (CSS px) and forwards them', async () => {
      const overlays = createOverlays({
        logo: {
          path: './logo.png',
          durationMs: 1000,
          relativeTo: 'screen',
          x: 200,
          y: 300,
          width: 600,
        },
      })

      await overlays.logo()

      expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
        kind: 'image',
        path: './logo.png',
        durationMs: 1000,
        fullScreen: false,
        placement: { relativeTo: 'screen', x: 200, y: 300, width: 600 },
      })
    })

    it('accepts a height-only placement (CSS px)', async () => {
      const overlays = createOverlays({
        logo: {
          path: './logo.png',
          durationMs: 1000,
          relativeTo: 'recording',
          height: 540,
        },
      })

      await overlays.logo()

      expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
        kind: 'image',
        path: './logo.png',
        durationMs: 1000,
        fullScreen: false,
        placement: { relativeTo: 'recording', x: 0, y: 0, height: 540 },
      })
    })

    it('forwards an explicit aspectRatio with the chosen axis', async () => {
      const overlays = createOverlays({
        logo: {
          path: './logo.png',
          durationMs: 1000,
          x: 100,
          y: 100,
          width: 480,
          aspectRatio: 16 / 9,
        },
      })

      await overlays.logo()

      expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
        kind: 'image',
        path: './logo.png',
        durationMs: 1000,
        fullScreen: false,
        placement: {
          relativeTo: 'recording',
          x: 100,
          y: 100,
          width: 480,
          aspectRatio: 16 / 9,
        },
      })
    })

    it('emits no placement (fills the recording) when no fields are given', async () => {
      const overlays = createOverlays({
        logo: { path: './logo.png', durationMs: 1000 },
      })

      await overlays.logo()

      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'logo',
        expect.not.objectContaining({ placement: expect.anything() })
      )
    })

    it('rejects positioning fields without a width or height', () => {
      expect(() =>
        createOverlays({
          logo: { path: './logo.png', durationMs: 1000, x: 100, y: 100 },
        })
      ).toThrow('Overlay "logo" must set "width" or "height"')
    })

    it('rejects setting both width and height', () => {
      expect(() =>
        createOverlays({
          logo: {
            path: './logo.png',
            durationMs: 1000,
            width: 300,
            height: 300,
          },
        })
      ).toThrow(
        'Overlay "logo" must set only one of width or height (the other is derived from the aspect ratio).'
      )
    })

    it('rejects a negative coordinate', () => {
      expect(() =>
        createOverlays({
          logo: { path: './logo.png', durationMs: 1000, x: -5, width: 300 },
        })
      ).toThrow(
        'Overlay "logo" x must be a non-negative number of CSS pixels. Received: -5'
      )
    })

    it('rejects a non-positive size', () => {
      expect(() =>
        createOverlays({
          logo: { path: './logo.png', durationMs: 1000, x: 0, width: 0 },
        })
      ).toThrow(
        'Overlay "logo" width must be a positive number of CSS pixels. Received: 0'
      )
    })

    it('rejects an invalid relativeTo', () => {
      expect(() =>
        createOverlays({
          logo: {
            path: './logo.png',
            durationMs: 1000,
            relativeTo: 'viewport' as never,
            width: 300,
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
      })

      await overlays.badge.end()
      expect(recorder.addAssetEnd).toHaveBeenCalledWith('badge', 'wait')
    })

    it('keeps overlapping overlays live and ends each by name independently', async () => {
      const overlays = createOverlays({
        a: { path: './a.png' },
        b: { path: './b.png' },
      })

      await overlays.a.start()
      await overlays.b.start()

      // Starting a second overlay does not auto-end the first: both stay live.
      expect(recorder.addAssetEnd).not.toHaveBeenCalled()

      await overlays.a.end()
      expect(recorder.addAssetEnd).toHaveBeenCalledWith('a', 'wait')
      await overlays.b.end()
      expect(recorder.addAssetEnd).toHaveBeenLastCalledWith('b', 'wait')
    })

    it('does not auto-end a live overlay when a blocking overlay runs', async () => {
      const overlays = createOverlays({
        a: { path: './a.png' },
        b: { path: './b.png', durationMs: 800 },
      })

      await overlays.a.start()
      await overlays.b()

      // The blocking overlay holds a frame while "a" stays composited: no end yet.
      expect(recorder.addAssetEnd).not.toHaveBeenCalled()
      expect(recorder.addAssetStart).toHaveBeenLastCalledWith('b', {
        kind: 'image',
        path: './b.png',
        durationMs: 800,
        fullScreen: false,
      })

      await overlays.a.end()
      expect(recorder.addAssetEnd).toHaveBeenCalledWith('a', 'wait')
    })

    it('starting the same overlay twice without ending throws', async () => {
      const overlays = createOverlays({ a: { path: './a.png' } })

      await overlays.a.start()
      await expect(overlays.a.start()).rejects.toThrow(
        'Overlay "a" is already started'
      )
    })

    it('end() without an active overlay throws', async () => {
      const overlays = createOverlays({ a: { path: './a.png' } })

      await expect(overlays.a.end()).rejects.toThrow(
        'Cannot call end() for overlay "a" because it is not a started overlay'
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

    it('reads an .html file and records a deferred image start (markup captured, not yet rasterized)', async () => {
      await writeFile(join(dir, 'hint.html'), '<div>Click</div>')
      const rasterize = vi.fn(async () => ({
        buffer: Buffer.from('png'),
        width: 200,
        height: 50,
      }))
      setHtmlRasterizer(rasterize)
      const overlays = createOverlays({
        hint: {
          path: './hint.html',
          durationMs: 1500,
          x: 200,
          y: 120,
          width: 600,
        },
      })

      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          page: fakePage,
          recordingDir: dir,
          testFilePath: join(dir, 'demo.screenci.ts'),
        }),
        () => overlays.hint()
      )

      // Deferred: the start is pending (no rasterization happened during the call).
      expect(recorder.addAssetStart).not.toHaveBeenCalled()
      expect(rasterize).not.toHaveBeenCalled()
      expect(recorder.addPendingAssetStart).toHaveBeenCalledWith(
        'hint',
        expect.objectContaining({
          kind: 'image',
          durationMs: 1500,
          fullScreen: false,
          placement: { relativeTo: 'recording', x: 200, y: 120, width: 600 },
          request: expect.objectContaining({
            kind: 'image',
            name: 'hint',
            html: '<div>Click</div>',
          }),
        })
      )
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

      expect(recorder.addPendingAssetStart).toHaveBeenCalledWith(
        'badge',
        expect.objectContaining({
          kind: 'image',
          durationMs: 1200,
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

      expect(recorder.addPendingAssetStart).toHaveBeenCalledWith(
        'badge',
        expect.not.objectContaining({ placement: expect.anything() })
      )
    })

    it('renders Playwright JSX nodes (.screenci.tsx files) by invoking components', async () => {
      // Playwright transpiles JSX in .screenci.tsx files with its own automatic
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

      expect(recorder.addPendingAssetStart).toHaveBeenCalledWith(
        'badge',
        expect.objectContaining({
          kind: 'image',
          request: expect.objectContaining({
            html: '<div class="badge">New</div>',
          }),
        })
      )
    })

    it('detects a bare Playwright JSX node as an element', async () => {
      const pwElement = {
        __pw_type: 'jsx',
        type: 'span',
        props: { children: 'hi' },
        key: null,
      }

      const overlays = createOverlays({ badge: pwElement })

      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          page: fakePage,
          recordingDir: dir,
        }),
        () => overlays.badge.start()
      )

      expect(recorder.addPendingAssetStart).toHaveBeenCalledWith(
        'badge',
        expect.objectContaining({
          kind: 'image',
          request: expect.objectContaining({ html: '<span>hi</span>' }),
        })
      )
    })

    it('renders an inline html fragment to an image overlay with placement', async () => {
      const overlays = createOverlays({
        note: {
          html: '<div class="note">Tip</div>',
          durationMs: 1400,
          x: 1340,
          y: 110,
          width: 380,
        },
      })

      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          page: fakePage,
          recordingDir: dir,
        }),
        () => overlays.note()
      )

      // The fragment is captured verbatim (the rasterizer wraps it at flush time).
      expect(recorder.addPendingAssetStart).toHaveBeenCalledWith(
        'note',
        expect.objectContaining({
          kind: 'image',
          durationMs: 1400,
          fullScreen: false,
          placement: { relativeTo: 'recording', x: 1340, y: 110, width: 380 },
          request: expect.objectContaining({
            html: '<div class="note">Tip</div>',
          }),
        })
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
      expect(recorder.addPendingAssetStart).not.toHaveBeenCalled()
    })

    it('runs the factory per call so props drive content and placement', async () => {
      const overlays = createOverlays({
        ring: (p: { label: string; x: number }) => ({
          html: `<div class="ring">${p.label}</div>`,
          durationMs: 1000,
          x: p.x,
          y: 300,
          width: 200,
        }),
      })

      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          page: fakePage,
          recordingDir: dir,
        }),
        async () => {
          await overlays.ring({ label: 'A', x: 100 })()
          await overlays.ring({ label: 'B', x: 500 })()
        }
      )

      expect(recorder.addPendingAssetStart).toHaveBeenNthCalledWith(
        1,
        'ring',
        expect.objectContaining({
          placement: { relativeTo: 'recording', x: 100, y: 300, width: 200 },
          request: expect.objectContaining({
            html: '<div class="ring">A</div>',
          }),
        })
      )
      expect(recorder.addPendingAssetStart).toHaveBeenNthCalledWith(
        2,
        'ring',
        expect.objectContaining({
          placement: { relativeTo: 'recording', x: 500, y: 300, width: 200 },
          request: expect.objectContaining({
            html: '<div class="ring">B</div>',
          }),
        })
      )
    })

    it('surfaces factory config validation errors at call time', () => {
      const overlays = createOverlays({
        bad: () => ({ path: './logo.png', element: createElement('div') }),
      })
      expect(() => overlays.bad({})).toThrow(
        'must provide only one of "path", "element", or "html"'
      )
    })

    it('positions over a locator and sizes the markup to the element box', async () => {
      const target = fakeLocator(
        { x: 100, y: 50, width: 300, height: 80 },
        { width: 1000, height: 500 }
      )
      const overlays = createOverlays({
        ring: (loc: Locator) => ({
          html: '<div class="ring"></div>',
          over: loc,
        }),
      })

      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          page: fakePage,
          recordingDir: dir,
        }),
        () => overlays.ring(target)(1000)
      )

      expect(recorder.addPendingAssetStart).toHaveBeenCalledWith(
        'ring',
        expect.objectContaining({
          // Placement comes from the locator box, in CSS px of the recording.
          placement: { relativeTo: 'recording', x: 100, y: 50, width: 300 },
          request: expect.objectContaining({
            // Markup is wrapped in a box sized to the element so the rasterized
            // PNG carries its aspect ratio.
            html: '<div style="width:300px;height:80px;box-sizing:border-box"><div class="ring"></div></div>',
          }),
        })
      )
    })

    it('applies margin (px) around the element when positioning over it', async () => {
      const target = fakeLocator(
        { x: 100, y: 100, width: 200, height: 200 },
        { width: 1000, height: 1000 }
      )
      const overlays = createOverlays({
        ring: (loc: Locator) => ({
          html: '<div></div>',
          over: loc,
          margin: 20,
        }),
      })

      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          page: fakePage,
          recordingDir: dir,
        }),
        () => overlays.ring(target)(1000)
      )

      expect(recorder.addPendingAssetStart).toHaveBeenCalledWith(
        'ring',
        expect.objectContaining({
          placement: { relativeTo: 'recording', x: 80, y: 80, width: 240 },
          request: expect.objectContaining({
            html: '<div style="width:240px;height:240px;box-sizing:border-box"><div></div></div>',
          }),
        })
      )
    })

    it('rejects over on a non-rendered (image/video) overlay', () => {
      const target = fakeLocator(
        { x: 0, y: 0, width: 10, height: 10 },
        { width: 100, height: 100 }
      )
      const overlays = createOverlays({
        badge: (loc: Locator) => ({ path: './badge.png', over: loc }),
      })
      expect(() => overlays.badge(target)).toThrow('can only use "over"')
    })

    it('rejects combining over with explicit placement fields', () => {
      const target = fakeLocator(
        { x: 0, y: 0, width: 10, height: 10 },
        { width: 100, height: 100 }
      )
      const overlays = createOverlays({
        ring: (loc: Locator) => ({
          html: '<div></div>',
          over: loc,
          width: 300,
        }),
      })
      expect(() => overlays.ring(target)).toThrow('cannot combine "over"')
    })

    it('rejects margin without over', () => {
      expect(() =>
        createOverlays({
          note: { html: '<div></div>', durationMs: 1000, margin: 10 },
        })
      ).toThrow('"margin" only applies when positioning over a locator')
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
          testFilePath: join(dir, 'demo.screenci.ts'),
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

      expect(recorder.addPendingAssetStart).toHaveBeenCalledWith(
        'intro',
        expect.objectContaining({
          kind: 'animation',
          durationMs: 1500,
          fullScreen: false,
          request: expect.objectContaining({
            kind: 'animation',
            durationMs: 1500,
            fps: 30,
          }),
        })
      )
    })

    it('uses the blocking call argument as the capture duration', async () => {
      const overlays = createOverlays({
        intro: { element: createElement('div', null, 'hi'), animate: true },
      })

      await run(() => overlays.intro(800))

      expect(recorder.addPendingAssetStart).toHaveBeenCalledWith(
        'intro',
        expect.objectContaining({ kind: 'animation', durationMs: 800 })
      )
    })

    it('does not hide or rasterize during the recording (deferred to flush)', async () => {
      const rasterize = vi.fn(async () => ({
        buffer: Buffer.from('mp4'),
        width: 320,
        height: 80,
      }))
      setAnimatedHtmlRasterizer(rasterize)
      const overlays = createOverlays({
        intro: {
          element: createElement('div', null, 'hi'),
          animate: true,
          durationMs: 1500,
        },
      })

      await run(() => overlays.intro())

      // Rasterization no longer happens inline, so there is no capture
      // wall-clock to hide from the timeline.
      expect(rasterize).not.toHaveBeenCalled()
      expect(recorder.addHideStart).not.toHaveBeenCalled()
      expect(recorder.addHideEnd).not.toHaveBeenCalled()
      expect(recorder.addPendingAssetStart).toHaveBeenCalledOnce()
    })

    it('animates an .html file overlay', async () => {
      await writeFile(join(dir, 'intro.html'), '<div class="fade">hi</div>')
      const overlays = createOverlays({
        intro: { path: './intro.html', animate: true, durationMs: 1000 },
      })

      await run(() => overlays.intro())

      expect(recorder.addPendingAssetStart).toHaveBeenCalledWith(
        'intro',
        expect.objectContaining({
          kind: 'animation',
          durationMs: 1000,
          request: expect.objectContaining({
            html: '<div class="fade">hi</div>',
          }),
        })
      )
    })

    it('animates an inline html fragment overlay', async () => {
      const overlays = createOverlays({
        intro: {
          html: '<div class="fade">hi</div>',
          animate: true,
          durationMs: 1000,
        },
      })

      await run(() => overlays.intro())

      expect(recorder.addPendingAssetStart).toHaveBeenCalledWith(
        'intro',
        expect.objectContaining({
          kind: 'animation',
          durationMs: 1000,
          request: expect.objectContaining({
            html: '<div class="fade">hi</div>',
          }),
        })
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

      const payload = vi.mocked(recorder.addPendingAssetStart).mock
        .calls[0]![1] as {
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

    it('captures css and capturePadding in the deferred animation request', async () => {
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

      expect(recorder.addPendingAssetStart).toHaveBeenCalledWith(
        'intro',
        expect.objectContaining({
          request: expect.objectContaining({
            css: '.card{color:red}',
            capturePadding: 80,
          }),
        })
      )
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

describe('buildStudioOverlays', () => {
  let recorder: IEventRecorder

  beforeEach(() => {
    recorder = createMockRecorder()
    setActiveAssetRecorder(recorder)
  })

  afterEach(() => {
    setActiveAssetRecorder(NOOP_EVENT_RECORDER)
  })

  it('creates a callable controller for each name', () => {
    const overlays = buildStudioOverlays(['intro', 'logo'])

    expect(typeof overlays.intro).toBe('function')
    expect(typeof overlays.logo).toBe('function')
  })

  it('records a studio asset start with the name', async () => {
    const overlays = buildStudioOverlays(['intro', 'logo'])

    await overlays.intro!()
    await overlays.logo!()

    expect(recorder.addStudioAssetStart).toHaveBeenCalledTimes(2)
    expect(recorder.addStudioAssetStart).toHaveBeenNthCalledWith(1, 'intro')
    expect(recorder.addStudioAssetStart).toHaveBeenNthCalledWith(2, 'logo')
    expect(recorder.addAssetStart).not.toHaveBeenCalled()
  })

  it('resolves immediately', async () => {
    const overlays = buildStudioOverlays(['intro'])

    await expect(overlays.intro!()).resolves.toBeUndefined()
  })

  it('does not require the overlay file to exist locally', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'screenci-studio-overlay-'))
    const overlays = buildStudioOverlays(['intro'])

    try {
      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          testFilePath: join(tempDir, 'demo.screenci.ts'),
        }),
        () => overlays.intro!()
      )

      expect(recorder.addStudioAssetStart).toHaveBeenCalledWith('intro')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe('selected (render dependency overlays)', () => {
  let recorder: IEventRecorder

  beforeEach(() => {
    recorder = createMockRecorder()
    setActiveAssetRecorder(recorder)
  })

  afterEach(() => {
    setActiveAssetRecorder(NOOP_EVENT_RECORDER)
  })

  it('produces a branded dependency input carrying the target name', () => {
    const input = selected('Intro Clip')
    expect(input.name).toBe('Intro Clip')
    expect(input.config).toEqual({})
  })

  it('rejects an empty target name', () => {
    expect(() => selected('')).toThrow(/non-empty name/)
    expect(() => selected('   ')).toThrow(/non-empty name/)
  })

  it('records a dependency assetStart with a duration when blocking', async () => {
    const overlays = createOverlays({ intro: selected('Intro Clip') })

    await overlays.intro(1200)

    expect(recorder.addAssetStart).toHaveBeenCalledOnce()
    expect(recorder.addAssetStart).toHaveBeenCalledWith('intro', {
      kind: 'dependency',
      dependency: { name: 'Intro Clip' },
      durationMs: 1200,
      fullScreen: false,
    })
  })

  it('uses the config duration when no call duration is given', async () => {
    const overlays = createOverlays({
      intro: selected('Intro Clip', { durationMs: 800 }),
    })

    await overlays.intro()

    expect(recorder.addAssetStart).toHaveBeenCalledWith('intro', {
      kind: 'dependency',
      dependency: { name: 'Intro Clip' },
      durationMs: 800,
      fullScreen: false,
    })
  })

  it('throws when a blocking dependency overlay has no duration', async () => {
    const overlays = createOverlays({ intro: selected('Intro Clip') })

    await expect(overlays.intro()).rejects.toThrow(/needs a duration/)
  })

  it('passes fill: screen as a fullScreen placement and omits duration for live windows', async () => {
    const overlays = createOverlays({
      intro: selected('Intro Clip', { fill: 'screen' }),
    })

    await overlays.intro.start()
    await overlays.intro.end()

    expect(recorder.addAssetStart).toHaveBeenCalledWith('intro', {
      kind: 'dependency',
      dependency: { name: 'Intro Clip' },
      fullScreen: true,
      placement: { fullScreen: true },
    })
    expect(recorder.addAssetEnd).toHaveBeenCalledWith('intro', 'wait')
  })

  it('resolves placement fields into a positioned overlay', async () => {
    const overlays = createOverlays({
      logo: selected('Logo Still', {
        x: 96,
        y: 96,
        width: 240,
        durationMs: 1000,
      }),
    })

    await overlays.logo()

    expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
      kind: 'dependency',
      dependency: { name: 'Logo Still' },
      durationMs: 1000,
      fullScreen: false,
      placement: { relativeTo: 'recording', x: 96, y: 96, width: 240 },
    })
  })

  it('does not read any local file for a dependency overlay', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'screenci-dep-overlay-'))
    const overlays = createOverlays({ intro: selected('Intro Clip') })

    try {
      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          recorder,
          testFilePath: join(tempDir, 'demo.screenci.ts'),
        }),
        () => overlays.intro(500)
      )

      expect(recorder.addAssetStart).toHaveBeenCalledWith('intro', {
        kind: 'dependency',
        dependency: { name: 'Intro Clip' },
        durationMs: 500,
        fullScreen: false,
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe('validateRegisteredAssetPaths', () => {
  beforeEach(() => {
    resetRegisteredAssetPaths()
  })

  afterEach(() => {
    resetRegisteredAssetPaths()
  })

  // createOverlays is called from this spec file, so its registrations are
  // attributed to it. Validation only checks registrations owned by the test
  // file it is given, so pass this spec's path to exercise them.
  const ownerFile = fileURLToPath(import.meta.url)

  it('passes when every registered overlay file exists', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'screenci-asset-validate-'))
    try {
      await writeFile(join(tempDir, 'logo.png'), 'png')
      await writeFile(join(tempDir, 'intro.mp4'), 'mp4')
      createOverlays({
        logo: { path: join(tempDir, 'logo.png'), durationMs: 1200 },
        intro: { path: join(tempDir, 'intro.mp4'), fill: 'screen' },
      })

      await expect(
        validateRegisteredAssetPaths(ownerFile)
      ).resolves.toBeUndefined()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('throws "Asset file not found" when a registered file is missing', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'screenci-asset-validate-'))
    try {
      await writeFile(join(tempDir, 'logo.png'), 'png')
      const missing = join(tempDir, 'intro.mp4')
      createOverlays({
        logo: { path: join(tempDir, 'logo.png'), durationMs: 1200 },
        intro: { path: missing, fill: 'screen' },
      })

      await expect(validateRegisteredAssetPaths(ownerFile)).rejects.toThrow(
        `Asset file not found: ${missing}`
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('skips registrations owned by a different test file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'screenci-asset-validate-'))
    try {
      // Owned by this spec file, and the file is missing. Validating against an
      // unrelated test file must not fail: another script may legitimately
      // reference a file that does not resolve there.
      createOverlays({ intro: { path: join(tempDir, 'gone.mp4') } })

      await expect(
        validateRegisteredAssetPaths(join(tempDir, 'other.screenci.ts'))
      ).resolves.toBeUndefined()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
