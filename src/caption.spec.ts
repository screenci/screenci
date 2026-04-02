import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createCaptions,
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
    addClick: vi.fn(),
    addMouseMove: vi.fn(),
    addCaptionStart: vi.fn(),
    addCaptionEnd: vi.fn(),
    getEvents: vi.fn<[], RecordingEvent[]>().mockReturnValue([]),
    writeToFile: vi
      .fn<[string, string], Promise<void>>()
      .mockResolvedValue(undefined),
  }
}

const singleLangMap = {
  en: {
    voice: voices.en.Jude,
    captions: { intro: 'Hello world', outro: 'Goodbye' },
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
    const captions = createCaptions(singleLangMap)

    expect(captions.intro).toBeDefined()
    expect(captions.outro).toBeDefined()
    expect(typeof captions.intro.start).toBe('function')
    expect(typeof captions.intro.end).toBe('function')
  })

  it('captions.key.start(): sleep → captionStart(multilang)', async () => {
    const captions = createCaptions(singleLangMap)

    await captions.intro.start()
    expect(order).toEqual(['sleep', 'captionStart(multilang)'])
  })

  it('captions.key.end(): captionEnd → sleep', async () => {
    const captions = createCaptions(singleLangMap)

    await captions.intro.start()
    order = []

    await captions.intro.end()
    expect(order).toEqual(['captionEnd', 'sleep'])
  })

  it('throws when calling end() without start()', async () => {
    const captions = createCaptions(singleLangMap)

    await expect(captions.intro.end()).rejects.toThrow(
      'No caption has been started'
    )
  })

  describe('without recorder', () => {
    beforeEach(() => setActiveCaptionRecorder(null))

    it('operations are no-ops', async () => {
      const captions = createCaptions(singleLangMap)

      await captions.intro.start()
      await captions.intro.end()

      expect(order).toEqual([])
    })
  })

  describe('inside hide()', () => {
    it('throws when calling start() inside hide()', async () => {
      const captions = createCaptions(singleLangMap)

      await expect(
        hide(async () => {
          await captions.intro.start()
        })
      ).rejects.toThrow('Cannot call caption.start inside hide()')
    })

    it('throws when calling end() inside hide()', async () => {
      const captions = createCaptions(singleLangMap)
      await captions.intro.start()

      await expect(
        hide(async () => {
          await captions.intro.end()
        })
      ).rejects.toThrow('Cannot call caption.waitEnd inside hide()')
    })
  })

  describe('with multi-language map', () => {
    const langMap = {
      en: {
        voice: voices.en.Jude,
        captions: { intro: 'Hello world', outro: 'Goodbye' },
      },
      fi: {
        voice: voices.fi.Martti,
        captions: { intro: 'Hei maailma', outro: 'Näkemiin' },
      },
    }

    it('creates caption controllers for each key', () => {
      const captions = createCaptions(langMap)
      expect(captions.intro).toBeDefined()
      expect(captions.outro).toBeDefined()
    })

    it('start() passes translations to addCaptionStart', async () => {
      const captions = createCaptions(langMap)
      await captions.intro.start()

      expect(recorder.addCaptionStart).toHaveBeenCalledWith(
        '',
        'intro',
        undefined,
        {
          en: { text: 'Hello world', voice: voices.en.Jude },
          fi: { text: 'Hei maailma', voice: voices.fi.Martti },
        }
      )
    })

    it('start() emits sleep → captionStart(multilang) sequence', async () => {
      const captions = createCaptions(langMap)
      await captions.intro.start()
      expect(order).toEqual(['sleep', 'captionStart(multilang)'])
    })

    it('allows custom voice refs before validation and resolves them at start()', async () => {
      const customVoice = {
        path: './olli-sample.mp3',
      } as CustomVoiceRef & { id?: string }
      const captions = createCaptions({
        en: {
          voice: voices.en.Jude,
          captions: { intro: 'Hello world' },
        },
        fi: {
          voice: customVoice,
          captions: { intro: 'Hei maailma' },
        },
      })

      customVoice.id = 'voice-hash'
      await captions.intro.start()

      expect(recorder.addCaptionStart).toHaveBeenCalledWith(
        '',
        'intro',
        undefined,
        {
          en: { text: 'Hello world', voice: voices.en.Jude },
          fi: {
            text: 'Hei maailma',
            voice: { id: 'voice-hash', path: './olli-sample.mp3' },
          },
        }
      )
    })
  })
})
