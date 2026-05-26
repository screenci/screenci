import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAssets, setActiveAssetRecorder } from './asset.js'
import { NOOP_EVENT_RECORDER, type IEventRecorder } from './events.js'
import type { RecordingEvent } from './events.js'

function createMockRecorder(): IEventRecorder {
  return {
    start: vi.fn(),
    addInput: vi.fn(),
    addCueStart: vi.fn(),
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
      logo: { path: './logo.png', audio: 0, fullScreen: false },
      intro: { path: './intro.mp4', audio: 1.0, fullScreen: true },
    })

    expect(assets.logo).toBeDefined()
    expect(assets.intro).toBeDefined()
    expect(typeof assets.logo).toBe('function')
    expect(typeof assets.intro).toBe('function')
  })

  describe('calling asset controller', () => {
    it('calls addAssetStart with correct arguments', async () => {
      const assets = createAssets({
        logo: { path: './logo.png', audio: 0, fullScreen: false },
      })

      await assets.logo()

      expect(recorder.addAssetStart).toHaveBeenCalledOnce()
      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'logo',
        './logo.png',
        0,
        false
      )
    })

    it('passes fullScreen: true correctly', async () => {
      const assets = createAssets({
        intro: { path: './intro.mp4', audio: 0.5, fullScreen: true },
      })

      await assets.intro()

      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'intro',
        './intro.mp4',
        0.5,
        true
      )
    })

    it('passes non-zero audio value', async () => {
      const assets = createAssets({
        audio: { path: './sound.mp4', audio: 0.8, fullScreen: false },
      })

      await assets.audio()

      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'audio',
        './sound.mp4',
        0.8,
        false
      )
    })

    it('resolves immediately', async () => {
      const assets = createAssets({
        clip: { path: './clip.mp4', audio: 0, fullScreen: true },
      })

      await expect(assets.clip()).resolves.toBeUndefined()
    })

    it('each controller uses its own name and config', async () => {
      const assets = createAssets({
        logo: { path: './logo.png', audio: 0, fullScreen: false },
        intro: { path: './intro.mp4', audio: 1.0, fullScreen: true },
      })

      await assets.logo()
      await assets.intro()

      expect(recorder.addAssetStart).toHaveBeenCalledTimes(2)
      expect(recorder.addAssetStart).toHaveBeenNthCalledWith(
        1,
        'logo',
        './logo.png',
        0,
        false
      )
      expect(recorder.addAssetStart).toHaveBeenNthCalledWith(
        2,
        'intro',
        './intro.mp4',
        1.0,
        true
      )
    })
  })

  describe('with the default no-op recorder', () => {
    beforeEach(() => setActiveAssetRecorder(NOOP_EVENT_RECORDER))

    it('calling the controller is a no-op', async () => {
      const assets = createAssets({
        logo: { path: './logo.png', audio: 0, fullScreen: false },
      })

      await expect(assets.logo()).resolves.toBeUndefined()
      expect(recorder.addAssetStart).not.toHaveBeenCalled()
    })
  })
})
