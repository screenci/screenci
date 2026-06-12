import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createAssets, setActiveAssetRecorder } from './asset.js'
import { NOOP_EVENT_RECORDER, type IEventRecorder } from './events.js'
import type { RecordingEvent } from './events.js'
import {
  createScreenCIRuntimeContext,
  runWithScreenCIRuntimeContext,
} from './runtimeContext.js'

function createMockRecorder(): IEventRecorder {
  return {
    start: vi.fn(),
    addInput: vi.fn(),
    addCueStart: vi.fn(),
    addStudioCueStart: vi.fn(),
    addCueEnd: vi.fn(),
    addVideoCueStart: vi.fn(),
    addAssetStart: vi.fn(),
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

describe('createAssets', () => {
  let recorder: IEventRecorder

  beforeEach(() => {
    recorder = createMockRecorder()
    setActiveAssetRecorder(recorder)
  })

  afterEach(() => {
    setActiveAssetRecorder(NOOP_EVENT_RECORDER)
  })

  it('creates a callable controller for each key in the map', () => {
    const assets = createAssets({
      logo: { path: './logo.png', durationMs: 1200, fullScreen: false },
      intro: { path: './intro.mp4', fullScreen: true },
    })

    expect(assets.logo).toBeDefined()
    expect(assets.intro).toBeDefined()
    expect(typeof assets.logo).toBe('function')
    expect(typeof assets.intro).toBe('function')
  })

  describe('calling asset controller', () => {
    it('calls addAssetStart with correct arguments', async () => {
      const assets = createAssets({
        logo: { path: './logo.png', durationMs: 1200, fullScreen: false },
      })

      await assets.logo()

      expect(recorder.addAssetStart).toHaveBeenCalledOnce()
      expect(recorder.addAssetStart).toHaveBeenCalledWith('logo', {
        kind: 'image',
        path: './logo.png',
        durationMs: 1200,
        fullScreen: false,
      })
    })

    it('passes fullScreen: true correctly', async () => {
      const assets = createAssets({
        intro: { path: './intro.mp4', audio: 0.5, fullScreen: true },
      })

      await assets.intro()

      expect(recorder.addAssetStart).toHaveBeenCalledWith('intro', {
        kind: 'video',
        path: './intro.mp4',
        audio: 0.5,
        fullScreen: true,
      })
    })

    it('passes non-zero audio value', async () => {
      const assets = createAssets({
        audio: { path: './sound.mp4', audio: 0.8, fullScreen: false },
      })

      await assets.audio()

      expect(recorder.addAssetStart).toHaveBeenCalledWith('audio', {
        kind: 'video',
        path: './sound.mp4',
        audio: 0.8,
        fullScreen: false,
      })
    })

    it('defaults mp4 audio to 1 when omitted', async () => {
      const assets = createAssets({
        intro: { path: './intro.mp4', fullScreen: true },
      })

      await assets.intro()

      expect(recorder.addAssetStart).toHaveBeenCalledWith('intro', {
        kind: 'video',
        path: './intro.mp4',
        audio: 1,
        fullScreen: true,
      })
    })

    it('resolves immediately', async () => {
      const assets = createAssets({
        clip: { path: './clip.mp4', fullScreen: true },
      })

      await expect(assets.clip()).resolves.toBeUndefined()
    })

    it('each controller uses its own name and config', async () => {
      const assets = createAssets({
        logo: { path: './logo.png', durationMs: 1200, fullScreen: false },
        intro: { path: './intro.mp4', fullScreen: true },
      })

      await assets.logo()
      await assets.intro()

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
      })
    })

    it('fails when the asset file is missing relative to the active test file', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'screenci-asset-spec-'))
      const assets = createAssets({
        logo: { path: './missing.png', durationMs: 1200, fullScreen: false },
      })

      try {
        await expect(
          runWithScreenCIRuntimeContext(
            createScreenCIRuntimeContext({
              recorder,
              testFilePath: join(tempDir, 'demo.video.ts'),
            }),
            () => assets.logo()
          )
        ).rejects.toThrow('Asset file not found: ./missing.png')
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    })

    it('resolves asset files relative to the active test file', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'screenci-asset-spec-'))
      await writeFile(join(tempDir, 'logo.png'), 'logo')
      const assets = createAssets({
        logo: { path: './logo.png', durationMs: 1200, fullScreen: false },
      })

      try {
        await runWithScreenCIRuntimeContext(
          createScreenCIRuntimeContext({
            recorder,
            testFilePath: join(tempDir, 'demo.video.ts'),
          }),
          () => assets.logo()
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

    it('rejects dynamic image paths without durationMs', () => {
      const dynamicPath = `./logo.${'png'}`

      expect(() =>
        createAssets({
          broken: {
            path: dynamicPath,
            fullScreen: false,
          } as never,
        })
      ).toThrow(
        'Asset "broken" (./logo.png) must provide a finite durationMs greater than or equal to 0.'
      )
    })

    it('rejects mp4 assets with durationMs', () => {
      expect(() =>
        createAssets({
          broken: {
            path: './clip.mp4',
            durationMs: 1000,
            audio: 0,
            fullScreen: true,
          } as never,
        })
      ).toThrow(
        'Asset "broken" (./clip.mp4) is a video asset and must not provide durationMs. Its natural media duration is used instead.'
      )
    })

    it('rejects mp4 assets with invalid audio when specified', () => {
      expect(() =>
        createAssets({
          broken: {
            path: './clip.mp4',
            audio: Number.NaN,
            fullScreen: true,
          } as never,
        })
      ).toThrow(
        'Asset "broken" (./clip.mp4) must provide a finite audio value between 0 and 1 for .mp4 assets when audio is specified. Use audio: 0 for silent playback.'
      )
    })

    it('rejects unsupported extensions', () => {
      expect(() =>
        createAssets({
          broken: {
            path: './photo.webp',
            audio: 0,
            fullScreen: false,
          } as never,
        })
      ).toThrow(
        'Asset "broken" must use one of: .svg, .png, .mp4. Received: ./photo.webp'
      )
    })
  })

  describe('with the default no-op recorder', () => {
    beforeEach(() => setActiveAssetRecorder(NOOP_EVENT_RECORDER))

    it('calling the controller is a no-op', async () => {
      const assets = createAssets({
        logo: { path: './logo.png', durationMs: 1200, fullScreen: false },
      })

      await expect(assets.logo()).resolves.toBeUndefined()
      expect(recorder.addAssetStart).not.toHaveBeenCalled()
    })
  })
})
