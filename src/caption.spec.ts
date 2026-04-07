import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createCaptions,
  setActiveCaptionRecorder,
  resetCaptionChain,
  setSleepFn,
} from './caption.js'
import { hide, setActiveHideRecorder } from './hide.js'
import type { IEventRecorder, VoiceLanguageMeta } from './events.js'
import type { RecordingEvent } from './events.js'
import type { CustomVoiceRef } from './voices.js'
import { voices } from './voices.js'

function createMockRecorder(): IEventRecorder {
  return {
    start: vi.fn(),
    addClick: vi.fn(),
    addMouseMove: vi.fn(),
    addCaptionStart: vi.fn(),
    addCaptionEnd: vi.fn(),
    registerVoiceForLang: vi.fn(),
    getEvents: vi.fn<[], RecordingEvent[]>().mockReturnValue([]),
    writeToFile: vi
      .fn<[string, string], Promise<void>>()
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

describe('createCaptions', () => {
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

  it('creates caption controllers for each key', () => {
    const captions = createCaptions(singleLangInput)

    expect(captions.intro).toBeDefined()
    expect(captions.outro).toBeDefined()
    expect(typeof captions.intro.start).toBe('function')
    expect(typeof captions.intro.end).toBe('function')
  })

  it('captions.key.start(): sleep → captionStart(multilang)', async () => {
    const captions = createCaptions(singleLangInput)

    await captions.intro.start()
    expect(order).toEqual(['sleep', 'captionStart(multilang)'])
  })

  it('captions.key.end(): captionEnd → sleep', async () => {
    const captions = createCaptions(singleLangInput)

    await captions.intro.start()
    order = []

    await captions.intro.end()
    expect(order).toEqual(['captionEnd', 'sleep'])
  })

  it('throws when calling end() without start()', async () => {
    const captions = createCaptions(singleLangInput)

    await expect(captions.intro.end()).rejects.toThrow(
      'No caption has been started'
    )
  })

  it('throws when languages is empty', () => {
    expect(() =>
      createCaptions({
        voice: { name: voices.Ava },
        // @ts-expect-error — empty languages should still throw at runtime
        languages: {},
      })
    ).toThrow('createCaptions requires at least one language in "languages"')
  })

  describe('without recorder', () => {
    beforeEach(() => setActiveCaptionRecorder(null))

    it('operations are no-ops', async () => {
      const captions = createCaptions(singleLangInput)

      await captions.intro.start()
      await captions.intro.end()

      expect(order).toEqual([])
    })
  })

  describe('inside hide()', () => {
    it('throws when calling start() inside hide()', async () => {
      const captions = createCaptions(singleLangInput)

      await expect(
        hide(async () => {
          await captions.intro.start()
        })
      ).rejects.toThrow('Cannot call caption.start inside hide()')
    })

    it('throws when calling end() inside hide()', async () => {
      const captions = createCaptions(singleLangInput)
      await captions.intro.start()

      await expect(
        hide(async () => {
          await captions.intro.end()
        })
      ).rejects.toThrow('Cannot call caption.waitEnd inside hide()')
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

    it('creates caption controllers for each key', () => {
      const captions = createCaptions(langInput)
      expect(captions.intro).toBeDefined()
      expect(captions.outro).toBeDefined()
    })

    it('start() passes translations to addCaptionStart', async () => {
      const captions = createCaptions(langInput)
      await captions.intro.start()

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

    it('start() emits sleep → captionStart(multilang) sequence', async () => {
      const captions = createCaptions(langInput)
      await captions.intro.start()
      expect(order).toEqual(['sleep', 'captionStart(multilang)'])
    })

    it('per-language voice override is used in translations', async () => {
      const captions = createCaptions({
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
      await captions.intro.start()

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

    it('allows custom voice refs before validation and resolves them at start()', async () => {
      const customVoice = {
        path: './olli-sample.mp3',
      } as CustomVoiceRef & { assetHash?: string }
      const captions = createCaptions({
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
      await captions.intro.start()

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
    it('registers voice meta via recorder on start()', async () => {
      const captions = createCaptions({
        voice: { name: voices.Ava, style: 'Clear and friendly' },
        languages: {
          en: { captions: { intro: 'Hello' } },
        },
      })
      await captions.intro.start()

      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
        style: 'Clear and friendly',
      })
    })

    it('per-language override style and seed are registered', async () => {
      const captions = createCaptions({
        voice: { name: voices.Ava, style: 'Default style' },
        languages: {
          en: { captions: { intro: 'Hello' } },
          fi: {
            voice: { name: voices.Nora, style: 'Selkeä', seed: 42 },
            captions: { intro: 'Hei' },
          },
        },
      })
      await captions.intro.start()

      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
        style: 'Default style',
      })
      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('fi', {
        name: 'Nora',
        style: 'Selkeä',
        seed: 42,
      })
    })

    it('top-level style is inherited by language without voice override', async () => {
      const captions = createCaptions({
        voice: { name: voices.Ava, style: 'Top style' },
        languages: {
          en: { captions: { intro: 'Hello' } },
          fi: {
            voice: { name: voices.Nora },
            captions: { intro: 'Hei' },
          },
        },
      })
      await captions.intro.start()

      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
        style: 'Top style',
      })
      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('fi', {
        name: 'Nora',
        style: 'Top style',
      })
    })

    it('omits style when not set', async () => {
      const captions = createCaptions({
        voice: { name: voices.Ava },
        languages: { en: { captions: { intro: 'Hello' } } },
      })
      await captions.intro.start()

      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
      })
    })
  })

  describe('runtime voice conflict validation (via recorder)', () => {
    it('throws when two createCaptions calls use different voices for the same language', async () => {
      const captions1 = createCaptions({
        voice: { name: voices.Ava },
        languages: { en: { captions: { intro: 'Hello' } } },
      })
      const captions2 = createCaptions({
        voice: { name: voices.Aria },
        languages: { en: { captions: { other: 'World' } } },
      })

      // Simulate what EventRecorder.registerVoiceForLang does
      ;(recorder.registerVoiceForLang as ReturnType<typeof vi.fn>)
        .mockImplementationOnce((_lang: string, _meta: VoiceLanguageMeta) => {
          // First call: en=Ava, no conflict
        })
        .mockImplementationOnce((_lang: string, meta: VoiceLanguageMeta) => {
          // Second call: en=Aria, recorder throws conflict
          throw new Error(
            `Multiple voice names registered for language "en": "Ava" and "${meta.name}". Only one voice per language per video is allowed.`
          )
        })

      await captions1.intro.start()
      await expect(captions2.other.start()).rejects.toThrow(
        'Multiple voice names registered for language "en": "Ava" and "Aria"'
      )
    })

    it('does not throw when two createCaptions calls use the same voice for a language', async () => {
      const captions1 = createCaptions({
        voice: { name: voices.Ava },
        languages: { en: { captions: { intro: 'Hello' } } },
      })
      const captions2 = createCaptions({
        voice: { name: voices.Ava },
        languages: { en: { captions: { other: 'World' } } },
      })

      await expect(captions1.intro.start()).resolves.toBeUndefined()
      await expect(captions2.other.start()).resolves.toBeUndefined()
    })
  })
})
