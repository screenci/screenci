import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAssets, setActiveAssetRecorder } from './asset.js'
import type { IEventRecorder } from './events.js'
import type { RecordingEvent } from './events.js'

function createMockRecorder(): IEventRecorder {
  return {
    start: vi.fn(),
    addInput: vi.fn(),
    addCaptionStart: vi.fn(),
    addCaptionUntil: vi.fn(),
    addCaptionEnd: vi.fn(),
    addAssetStart: vi.fn(),
    addAssetEnd: vi.fn(),
    addHideStart: vi.fn(),
    addHideEnd: vi.fn(),
    addAutoZoomStart: vi.fn(),
    addAutoZoomEnd: vi.fn(),
    getEvents: vi.fn<[], RecordingEvent[]>().mockReturnValue([]),
    writeToFile: vi
      .fn<[string, string], Promise<void>>()
      .mockResolvedValue(undefined),
  }
}

describe('createAssets', () => {
  let recorder: IEventRecorder

  beforeEach(() => {
    recorder = createMockRecorder()
    setActiveAssetRecorder(recorder)
    vi.useFakeTimers()
  })

  afterEach(() => {
    setActiveAssetRecorder(null)
    vi.useRealTimers()
  })

  it('creates controllers for each key in the map', () => {
    const assets = createAssets({
      logo: { path: './logo.png', audio: 0, fullScreen: false, duration: 1000 },
      intro: { path: './intro.mp4', audio: 1.0, fullScreen: true },
    })

    expect(assets.logo).toBeDefined()
    expect(assets.intro).toBeDefined()
    expect(typeof assets.logo.show).toBe('function')
    expect(typeof assets.logo.hide).toBe('function')
    expect(typeof assets.logo.then).toBe('function')
  })

  describe('show()', () => {
    it('calls addAssetStart with correct arguments', async () => {
      const assets = createAssets({
        logo: {
          path: './logo.png',
          audio: 0,
          fullScreen: false,
          duration: 1000,
        },
      })

      const showPromise = assets.logo.show()
      expect(recorder.addAssetStart).toHaveBeenCalledOnce()
      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'logo',
        './logo.png',
        0,
        false
      )
      vi.runAllTimers()
      await showPromise
    })

    it('passes fullScreen: true correctly', async () => {
      const assets = createAssets({
        intro: { path: './intro.mp4', audio: 0.5, fullScreen: true },
      })

      await assets.intro.show()

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

      await assets.audio.show()

      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'audio',
        './sound.mp4',
        0.8,
        false
      )
    })

    describe('image auto-hide', () => {
      it('auto-records assetEnd after duration for image assets', async () => {
        const assets = createAssets({
          logo: {
            path: './logo.png',
            audio: 0,
            fullScreen: false,
            duration: 2000,
          },
        })

        const showPromise = assets.logo.show()
        expect(recorder.addAssetEnd).not.toHaveBeenCalled()

        vi.advanceTimersByTime(2000)
        await showPromise

        expect(recorder.addAssetEnd).toHaveBeenCalledOnce()
        expect(recorder.addAssetEnd).toHaveBeenCalledWith('logo')
      })

      it('show() resolves after duration for image assets', async () => {
        const assets = createAssets({
          logo: {
            path: './logo.png',
            audio: 0,
            fullScreen: false,
            duration: 500,
          },
        })

        let resolved = false
        const showPromise = assets.logo.show().then(() => {
          resolved = true
        })

        expect(resolved).toBe(false)
        vi.advanceTimersByTime(500)
        await showPromise
        expect(resolved).toBe(true)
      })

      it('cancels auto-hide when hide() is called before duration expires', async () => {
        const assets = createAssets({
          logo: {
            path: './logo.png',
            audio: 0,
            fullScreen: false,
            duration: 5000,
          },
        })

        assets.logo.show()
        expect(recorder.addAssetStart).toHaveBeenCalledOnce()

        await assets.logo.hide()
        expect(recorder.addAssetEnd).toHaveBeenCalledOnce()

        // Duration fires — should NOT record a second assetEnd
        vi.advanceTimersByTime(5000)
        await Promise.resolve()
        expect(recorder.addAssetEnd).toHaveBeenCalledOnce()
      })

      it('show() returns immediately for video assets (no duration)', async () => {
        const assets = createAssets({
          clip: { path: './clip.mp4', audio: 0, fullScreen: false },
        })

        let resolved = false
        await assets.clip.show().then(() => {
          resolved = true
        })

        expect(resolved).toBe(true)
        expect(recorder.addAssetEnd).not.toHaveBeenCalled()
      })
    })
  })

  describe('hide()', () => {
    it('calls addAssetEnd with the asset name', async () => {
      const assets = createAssets({
        logo: {
          path: './logo.png',
          audio: 0,
          fullScreen: false,
          duration: 1000,
        },
      })

      await assets.logo.hide()

      expect(recorder.addAssetEnd).toHaveBeenCalledOnce()
      expect(recorder.addAssetEnd).toHaveBeenCalledWith('logo')
    })
  })

  describe('await assets.name (thenable)', () => {
    it('await calls show() — addAssetStart is invoked', async () => {
      const assets = createAssets({
        logo: {
          path: './logo.png',
          audio: 0,
          fullScreen: false,
          duration: 1000,
        },
      })

      const awaitPromise = assets.logo.then(() => {})
      expect(recorder.addAssetStart).toHaveBeenCalledOnce()
      expect(recorder.addAssetStart).toHaveBeenCalledWith(
        'logo',
        './logo.png',
        0,
        false
      )
      await vi.runAllTimersAsync()
      await awaitPromise
    })

    it('await resolves to void without error', async () => {
      const assets = createAssets({
        logo: {
          path: './logo.png',
          audio: 0,
          fullScreen: false,
          duration: 100,
        },
      })

      const awaitPromise = assets.logo.then(() => undefined)
      await vi.runAllTimersAsync()
      const result = await awaitPromise
      expect(result).toBeUndefined()
    })
  })

  describe('without active recorder', () => {
    beforeEach(() => setActiveAssetRecorder(null))

    it('show() is a no-op', async () => {
      const assets = createAssets({
        logo: {
          path: './logo.png',
          audio: 0,
          fullScreen: false,
          duration: 1000,
        },
      })

      await expect(assets.logo.show()).resolves.toBeUndefined()
      expect(recorder.addAssetStart).not.toHaveBeenCalled()
    })

    it('hide() is a no-op', async () => {
      const assets = createAssets({
        logo: {
          path: './logo.png',
          audio: 0,
          fullScreen: false,
          duration: 1000,
        },
      })

      await expect(assets.logo.hide()).resolves.toBeUndefined()
      expect(recorder.addAssetEnd).not.toHaveBeenCalled()
    })

    it('await (thenable) is a no-op', async () => {
      const assets = createAssets({
        logo: {
          path: './logo.png',
          audio: 0,
          fullScreen: false,
          duration: 1000,
        },
      })

      await assets.logo
      expect(recorder.addAssetStart).not.toHaveBeenCalled()
    })
  })

  it('each controller uses its own name and config', async () => {
    const assets = createAssets({
      logo: { path: './logo.png', audio: 0, fullScreen: false, duration: 1000 },
      intro: { path: './intro.mp4', audio: 1.0, fullScreen: true },
    })

    const logoPromise = assets.logo.show()
    await assets.intro.show()

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

    vi.runAllTimers()
    await logoPromise
  })
})
