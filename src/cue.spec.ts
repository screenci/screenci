import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createNarration,
  setActiveCueRecorder,
  resetCueChain,
  setSleepFn,
} from './cue.js'
import * as screenci from '../index.js'
import { hide, setActiveHideRecorder } from './hide.js'
import type { IEventRecorder } from './events.js'
import type { RecordingEvent } from './events.js'
import type { CustomVoiceRef } from './voices.js'
import { voices } from './voices.js'

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

const singleLangInput = {
  voice: { name: voices.Ava },
  languages: {
    en: {
      cues: { intro: 'Hello world', outro: 'Goodbye' },
    },
  },
}

describe('createNarration', () => {
  let recorder: IEventRecorder
  let order: string[]

  beforeEach(() => {
    order = []
    recorder = createMockRecorder()
    resetCueChain()
    ;(recorder.addCueStart as ReturnType<typeof vi.fn>).mockImplementation(
      (text: string, _name: string, _config: unknown, translations: unknown) =>
        order.push(translations ? `cueStart(multilang)` : `cueStart(${text})`)
    )
    ;(recorder.addCueEnd as ReturnType<typeof vi.fn>).mockImplementation(() =>
      order.push('cueEnd')
    )
    setSleepFn(() => order.push('sleep'))
    setActiveCueRecorder(recorder)
  })

  afterEach(() => {
    setActiveCueRecorder(null)
    setActiveHideRecorder(null)
    setSleepFn((ms) => {
      const end = performance.now() + ms
      while (performance.now() < end) {}
    })
  })

  it('creates thenable cue controllers for each key', () => {
    const cues = createNarration(singleLangInput)

    expect(cues.intro).toBeDefined()
    expect(cues.outro).toBeDefined()
    expect(typeof cues.intro.then).toBe('function')
    expect(typeof cues.outro.then).toBe('function')
  })

  it('exposes wait() on the result', () => {
    const cues = createNarration(singleLangInput)
    expect(typeof cues.wait).toBe('function')
  })

  it('await narration.key: sleep → cueStart(multilang)', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro
    expect(order).toEqual(['sleep', 'cueStart(multilang)'])
  })

  it('wait(): cueEnd → sleep', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro
    order = []

    await cues.wait()
    expect(order).toEqual(['cueEnd', 'sleep'])
  })

  it('wait() is a no-op when no cue is active', async () => {
    const cues = createNarration(singleLangInput)
    await cues.wait()
    expect(order).toEqual([])
  })

  it('consecutive narration segments auto-end the previous: sleep → cueStart → cueEnd → sleep → cueStart', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro
    order = []

    await cues.outro
    expect(order).toEqual(['cueEnd', 'sleep', 'sleep', 'cueStart(multilang)'])
  })

  it('wait() after wait() is a no-op', async () => {
    const cues = createNarration(singleLangInput)
    await cues.intro
    await cues.wait()
    order = []
    await cues.wait()
    expect(order).toEqual([])
  })

  it('throws when languages is empty', () => {
    expect(() =>
      createNarration({
        voice: { name: voices.Ava },
        languages: {},
      })
    ).toThrow('createNarration requires at least one language in "languages"')
  })

  it('keeps createNarration as a backwards-compatible alias', () => {
    const cues = createNarration(singleLangInput)

    expect(cues.intro).toBeDefined()
    expect(typeof cues.wait).toBe('function')
  })

  it('does not export createVideoCues from the package root', () => {
    expect(
      (screenci as Record<string, unknown>).createVideoCues
    ).toBeUndefined()
  })

  describe('without recorder', () => {
    beforeEach(() => setActiveCueRecorder(null))

    it('operations are no-ops', async () => {
      const cues = createNarration(singleLangInput)

      await cues.intro
      await cues.wait()

      expect(order).toEqual([])
    })
  })

  describe('inside hide()', () => {
    it('throws when starting narration inside hide()', async () => {
      const cues = createNarration(singleLangInput)

      await expect(
        hide(async () => {
          await cues.intro
        })
      ).rejects.toThrow('Cannot start narration inside hide()')
    })

    it('throws when calling wait() inside hide()', async () => {
      const cues = createNarration(singleLangInput)
      await cues.intro

      await expect(
        hide(async () => {
          await cues.wait()
        })
      ).rejects.toThrow('Cannot call wait() inside hide()')
    })
  })

  describe('with multi-language map', () => {
    const langInput = {
      voice: { name: voices.Ava },
      languages: {
        en: {
          cues: { intro: 'Hello world', outro: 'Goodbye' },
        },
        fi: {
          cues: { intro: 'Hei maailma', outro: 'Näkemiin' },
        },
      },
    }

    it('creates thenable controllers for each key', () => {
      const cues = createNarration(langInput)
      expect(typeof cues.intro.then).toBe('function')
      expect(typeof cues.outro.then).toBe('function')
    })

    it('await passes translations to addCueStart', async () => {
      const cues = createNarration(langInput)
      await cues.intro

      expect(recorder.addCueStart).toHaveBeenCalledWith(
        '',
        'intro',
        undefined,
        {
          en: { text: 'Hello world', voice: voices.Ava },
          fi: { text: 'Hei maailma', voice: voices.Ava },
        }
      )
    })

    it('await emits sleep → cueStart(multilang) sequence', async () => {
      const cues = createNarration(langInput)
      await cues.intro
      expect(order).toEqual(['sleep', 'cueStart(multilang)'])
    })

    it('per-language narrationride is used in translations', async () => {
      const cues = createNarration({
        voice: { name: voices.Ava },
        languages: {
          en: {
            cues: { intro: 'Hello world' },
          },
          fi: {
            voice: { name: voices.Nora },
            cues: { intro: 'Hei maailma' },
          },
        },
      })
      await cues.intro

      expect(recorder.addCueStart).toHaveBeenCalledWith(
        '',
        'intro',
        undefined,
        {
          en: { text: 'Hello world', voice: voices.Ava },
          fi: { text: 'Hei maailma', voice: voices.Nora },
        }
      )
    })

    it('supports cue objects with text and media fields', async () => {
      const cues = createNarration({
        voice: { name: voices.Ava },
        languages: {
          en: {
            cues: {
              intro: {
                media: '/tmp/intro-en.mp4',
                subtitle: 'Intro subtitle',
              },
            },
          },
          fi: {
            cues: {
              intro: { text: 'Hei maailma' },
            },
          },
        },
      })

      await expect(cues.intro).rejects.toThrow(
        'Video cue asset hash missing for path: /tmp/intro-en.mp4'
      )
    })

    it('allows custom voice refs before validation and resolves them at start', async () => {
      const customVoice = {
        path: './olli-sample.mp3',
      } as CustomVoiceRef & { assetHash?: string }
      const cues = createNarration({
        voice: { name: voices.Ava },
        languages: {
          en: {
            cues: { intro: 'Hello world' },
          },
          fi: {
            voice: { name: customVoice },
            cues: { intro: 'Hei maailma' },
          },
        },
      })

      customVoice.assetHash = 'voice-hash'
      await cues.intro

      expect(recorder.addCueStart).toHaveBeenCalledWith(
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
      const cues = createNarration({
        voice: { name: voices.Ava },
        languages: {
          en: { cues: { intro: 'Hello' } },
        },
      })
      await cues.intro

      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
      })
    })

    it('per-language override seed is registered', async () => {
      const cues = createNarration({
        voice: { name: voices.Ava },
        languages: {
          en: { cues: { intro: 'Hello' } },
          fi: {
            voice: { name: voices.Nora, seed: 42 },
            cues: { intro: 'Hei' },
          },
        },
      })
      await cues.intro

      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
      })
      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('fi', {
        name: 'Nora',
        seed: 42,
      })
    })

    it('per-language region is registered', async () => {
      const cues = createNarration({
        voice: { name: voices.Ava },
        languages: {
          en: { region: 'en-US', cues: { intro: 'Hello' } },
        },
      })
      await cues.intro

      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
        region: 'en-US',
      })
    })

    it('omits region when not set', async () => {
      const cues = createNarration({
        voice: { name: voices.Ava },
        languages: { en: { cues: { intro: 'Hello' } } },
      })
      await cues.intro

      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
      })
    })
  })

  describe('runtime voice registration (via recorder)', () => {
    it('allows different voices for the same language across cues', async () => {
      const cues1 = createNarration({
        voice: { name: voices.Ava },
        languages: { en: { cues: { intro: 'Hello' } } },
      })
      const cues2 = createNarration({
        voice: { name: voices.Aria },
        languages: { en: { cues: { other: 'World' } } },
      })

      await cues1.intro
      await expect(cues2.other).resolves.toBeUndefined()
    })

    it('does not throw when two createNarration calls use the same voice for a language', async () => {
      const cues1 = createNarration({
        voice: { name: voices.Ava },
        languages: { en: { cues: { intro: 'Hello' } } },
      })
      const cues2 = createNarration({
        voice: { name: voices.Ava },
        languages: { en: { cues: { other: 'World' } } },
      })

      await expect(cues1.intro).resolves.toBeUndefined()
      await expect(cues2.other).resolves.toBeUndefined()
    })
  })
})
