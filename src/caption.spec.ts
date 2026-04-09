import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createVoiceOvers,
  setActiveCaptionRecorder,
  resetCaptionChain,
  setSleepFn,
} from './caption.js'
import { hide, setActiveHideRecorder } from './hide.js'
import type { IEventRecorder } from './events.js'
import type { RecordingEvent } from './events.js'
import type { CustomVoiceRef } from './voices.js'
import { voices } from './voices.js'

function createMockRecorder(): IEventRecorder {
  return {
    start: vi.fn(),
    addInput: vi.fn(),
    addCaptionStart: vi.fn(),
    addCaptionEnd: vi.fn(),
    addVideoCaptionStart: vi.fn(),
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

const singleLangInput = {
  voice: { name: voices.Ava },
  languages: {
    en: {
      captions: { intro: 'Hello world', outro: 'Goodbye' },
    },
  },
}

describe('createVoiceOvers', () => {
  let recorder: IEventRecorder
  let order: string[]

  beforeEach(() => {
    order = []
    recorder = createMockRecorder()
    resetCaptionChain()
    ;(recorder.addCaptionStart as ReturnType<typeof vi.fn>).mockImplementation(
      (text: string, _name: string, _config: unknown, translations: unknown) =>
        order.push(
          translations ? `captionStart(multilang)` : `captionStart(${text})`
        )
    )
    ;(recorder.addCaptionEnd as ReturnType<typeof vi.fn>).mockImplementation(
      () => order.push('captionEnd')
    )
    setSleepFn(() => order.push('sleep'))
    setActiveCaptionRecorder(recorder)
  })

  afterEach(() => {
    setActiveCaptionRecorder(null)
    setActiveHideRecorder(null)
    setSleepFn((ms) => {
      const end = performance.now() + ms
      while (performance.now() < end) {}
    })
  })

  it('creates thenable caption controllers for each key', () => {
    const captions = createVoiceOvers(singleLangInput)

    expect(captions.intro).toBeDefined()
    expect(captions.outro).toBeDefined()
    expect(typeof captions.intro.then).toBe('function')
    expect(typeof captions.outro.then).toBe('function')
  })

  it('exposes waitEnd() on the result', () => {
    const captions = createVoiceOvers(singleLangInput)
    expect(typeof captions.waitEnd).toBe('function')
  })

  it('await voiceOvers.key: sleep → captionStart(multilang)', async () => {
    const captions = createVoiceOvers(singleLangInput)

    await captions.intro
    expect(order).toEqual(['sleep', 'captionStart(multilang)'])
  })

  it('waitEnd(): captionEnd → sleep', async () => {
    const captions = createVoiceOvers(singleLangInput)

    await captions.intro
    order = []

    await captions.waitEnd()
    expect(order).toEqual(['captionEnd', 'sleep'])
  })

  it('waitEnd() is a no-op when no caption is active', async () => {
    const captions = createVoiceOvers(singleLangInput)
    await captions.waitEnd()
    expect(order).toEqual([])
  })

  it('consecutive voiceOvers auto-end the previous: sleep → captionStart → captionEnd → sleep → captionStart', async () => {
    const captions = createVoiceOvers(singleLangInput)

    await captions.intro
    order = []

    await captions.outro
    expect(order).toEqual([
      'captionEnd',
      'sleep',
      'sleep',
      'captionStart(multilang)',
    ])
  })

  it('waitEnd() after waitEnd() is a no-op', async () => {
    const captions = createVoiceOvers(singleLangInput)
    await captions.intro
    await captions.waitEnd()
    order = []
    await captions.waitEnd()
    expect(order).toEqual([])
  })

  it('throws when languages is empty', () => {
    expect(() =>
      createVoiceOvers({
        voice: { name: voices.Ava },
        languages: {},
      })
    ).toThrow('createVoiceOvers requires at least one language in "languages"')
  })

  describe('without recorder', () => {
    beforeEach(() => setActiveCaptionRecorder(null))

    it('operations are no-ops', async () => {
      const captions = createVoiceOvers(singleLangInput)

      await captions.intro
      await captions.waitEnd()

      expect(order).toEqual([])
    })
  })

  describe('inside hide()', () => {
    it('throws when starting a voiceOver inside hide()', async () => {
      const captions = createVoiceOvers(singleLangInput)

      await expect(
        hide(async () => {
          await captions.intro
        })
      ).rejects.toThrow('Cannot start a voiceOver inside hide()')
    })

    it('throws when calling waitEnd() inside hide()', async () => {
      const captions = createVoiceOvers(singleLangInput)
      await captions.intro

      await expect(
        hide(async () => {
          await captions.waitEnd()
        })
      ).rejects.toThrow('Cannot call waitEnd inside hide()')
    })
  })

  describe('with multi-language map', () => {
    const langInput = {
      voice: { name: voices.Ava },
      languages: {
        en: {
          captions: { intro: 'Hello world', outro: 'Goodbye' },
        },
        fi: {
          captions: { intro: 'Hei maailma', outro: 'Näkemiin' },
        },
      },
    }

    it('creates thenable controllers for each key', () => {
      const captions = createVoiceOvers(langInput)
      expect(typeof captions.intro.then).toBe('function')
      expect(typeof captions.outro.then).toBe('function')
    })

    it('await passes translations to addCaptionStart', async () => {
      const captions = createVoiceOvers(langInput)
      await captions.intro

      expect(recorder.addCaptionStart).toHaveBeenCalledWith(
        '',
        'intro',
        undefined,
        {
          en: { text: 'Hello world', voice: voices.Ava },
          fi: { text: 'Hei maailma', voice: voices.Ava },
        }
      )
    })

    it('await emits sleep → captionStart(multilang) sequence', async () => {
      const captions = createVoiceOvers(langInput)
      await captions.intro
      expect(order).toEqual(['sleep', 'captionStart(multilang)'])
    })

    it('per-language voice override is used in translations', async () => {
      const captions = createVoiceOvers({
        voice: { name: voices.Ava },
        languages: {
          en: {
            captions: { intro: 'Hello world' },
          },
          fi: {
            voice: { name: voices.Nora },
            captions: { intro: 'Hei maailma' },
          },
        },
      })
      await captions.intro

      expect(recorder.addCaptionStart).toHaveBeenCalledWith(
        '',
        'intro',
        undefined,
        {
          en: { text: 'Hello world', voice: voices.Ava },
          fi: { text: 'Hei maailma', voice: voices.Nora },
        }
      )
    })

    it('allows custom voice refs before validation and resolves them at start', async () => {
      const customVoice = {
        path: './olli-sample.mp3',
      } as CustomVoiceRef & { assetHash?: string }
      const captions = createVoiceOvers({
        voice: { name: voices.Ava },
        languages: {
          en: {
            captions: { intro: 'Hello world' },
          },
          fi: {
            voice: { name: customVoice },
            captions: { intro: 'Hei maailma' },
          },
        },
      })

      customVoice.assetHash = 'voice-hash'
      await captions.intro

      expect(recorder.addCaptionStart).toHaveBeenCalledWith(
        '',
        'intro',
        undefined,
        {
          en: { text: 'Hello world', voice: voices.Ava },
          fi: {
            text: 'Hei maailma',
            voice: { assetHash: 'voice-hash', assetPath: './olli-sample.mp3' },
          },
        }
      )
    })
  })

  describe('voice metadata registration', () => {
    it('registers voice meta via recorder on await', async () => {
      const captions = createVoiceOvers({
        voice: { name: voices.Ava },
        languages: {
          en: { captions: { intro: 'Hello' } },
        },
      })
      await captions.intro

      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
      })
    })

    it('per-language override seed is registered', async () => {
      const captions = createVoiceOvers({
        voice: { name: voices.Ava },
        languages: {
          en: { captions: { intro: 'Hello' } },
          fi: {
            voice: { name: voices.Nora, seed: 42 },
            captions: { intro: 'Hei' },
          },
        },
      })
      await captions.intro

      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
      })
      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('fi', {
        name: 'Nora',
        seed: 42,
      })
    })

    it('per-language region is registered', async () => {
      const captions = createVoiceOvers({
        voice: { name: voices.Ava },
        languages: {
          en: { region: 'en-US', captions: { intro: 'Hello' } },
        },
      })
      await captions.intro

      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
        region: 'en-US',
      })
    })

    it('omits region when not set', async () => {
      const captions = createVoiceOvers({
        voice: { name: voices.Ava },
        languages: { en: { captions: { intro: 'Hello' } } },
      })
      await captions.intro

      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
      })
    })
  })

  describe('runtime voice registration (via recorder)', () => {
    it('allows different voices for the same language across captions', async () => {
      const captions1 = createVoiceOvers({
        voice: { name: voices.Ava },
        languages: { en: { captions: { intro: 'Hello' } } },
      })
      const captions2 = createVoiceOvers({
        voice: { name: voices.Aria },
        languages: { en: { captions: { other: 'World' } } },
      })

      await captions1.intro
      await expect(captions2.other).resolves.toBeUndefined()
    })

    it('does not throw when two createVoiceOvers calls use the same voice for a language', async () => {
      const captions1 = createVoiceOvers({
        voice: { name: voices.Ava },
        languages: { en: { captions: { intro: 'Hello' } } },
      })
      const captions2 = createVoiceOvers({
        voice: { name: voices.Ava },
        languages: { en: { captions: { other: 'World' } } },
      })

      await expect(captions1.intro).resolves.toBeUndefined()
      await expect(captions2.other).resolves.toBeUndefined()
    })
  })
})
