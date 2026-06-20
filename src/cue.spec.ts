import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fileURLToPath } from 'url'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  createNarration,
  createStudioNarration,
  setActiveCueRecorder,
  resetCueChain,
  setSleepFn,
  validateCustomVoiceRefs,
} from './cue.js'
import * as screenci from '../index.js'
import { hide, setActiveHideRecorder } from './hide.js'
import { speed } from './speed.js'
import { time } from './time.js'
import { NOOP_EVENT_RECORDER, type IEventRecorder } from './events.js'
import type { RecordingEvent } from './events.js'
import type { CustomVoiceRef } from './voices.js'
import { modelTypes, voices } from './voices.js'
import { logger } from './logger.js'
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
    addSpeedStart: vi.fn(),
    addSpeedEnd: vi.fn(),
    addTimeStart: vi.fn(),
    addTimeEnd: vi.fn(),
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
  en: {
    intro: 'Hello world',
    outro: 'Goodbye',
  },
}

describe('createNarration', () => {
  let recorder: IEventRecorder
  let order: string[]
  let warnSpy: ReturnType<typeof vi.spyOn>
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    order = []
    recorder = createMockRecorder()
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
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
    process.env = originalEnv
    warnSpy.mockRestore()
    setActiveCueRecorder(NOOP_EVENT_RECORDER)
    setActiveHideRecorder(NOOP_EVENT_RECORDER)
    setSleepFn((ms) => {
      const end = performance.now() + ms
      while (performance.now() < end) {}
    })
  })

  it('exposes callable cues with start() and end() for each cue', () => {
    const cues = createNarration(singleLangInput)

    expect(cues.intro).toBeDefined()
    expect(cues.outro).toBeDefined()
    expect(typeof cues.intro).toBe('function')
    expect(typeof cues.intro.start).toBe('function')
    expect(typeof cues.intro.end).toBe('function')
    expect(typeof cues.outro.start).toBe('function')
    expect(typeof cues.outro.end).toBe('function')
  })

  it('start() emits cue start', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro.start()
    expect(order).toEqual(['sleep', 'cueStart(multilang)'])
  })

  it('skips cue frame-gap sleeps when recording timings are disabled', async () => {
    process.env.SCREENCI_DISABLE_RECORDING_TIMINGS = 'true'
    const cues = createNarration(singleLangInput)

    await cues.intro()

    expect(order).toEqual(['cueStart(multilang)', 'cueEnd'])
  })

  it('calling a cue runs one start and one end for a single run', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro()
    expect(order).toEqual([
      'sleep',
      'cueStart(multilang)',
      'sleep',
      'cueEnd',
      'sleep',
    ])
  })

  it('start() then end() does not replay', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro.start()
    order = []

    await cues.intro.end()
    expect(order).toEqual(['cueEnd', 'sleep'])
  })

  it('end() without prior start() throws', async () => {
    const cues = createNarration(singleLangInput)

    await expect(cues.intro.end()).rejects.toThrow(
      'Cannot call end() for cue "intro" because it is not the active started cue'
    )
  })

  it('start() on one cue then start() on another auto-ends the first', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro.start()
    order = []

    await cues.outro.start()
    expect(order).toEqual(['cueEnd', 'sleep', 'sleep', 'cueStart(multilang)'])
    expect(warnSpy).toHaveBeenCalledWith(
      '[screenci] Cue "intro" was started with .start() and auto-ended when cue "outro" started. Call .end() explicitly before starting the next narration cue.'
    )
  })

  it('start() on one cue then end() on another throws', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro.start()

    await expect(cues.outro.end()).rejects.toThrow(
      'Cannot call end() for cue "outro" because it is not the active started cue'
    )
  })

  it('start() on one cue then start() on another still auto-ends the first', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro.start()
    order = []

    await cues.outro.start()
    expect(order).toEqual(['cueEnd', 'sleep', 'sleep', 'cueStart(multilang)'])
  })

  it('warns when a cue started with .start() is followed by a callable cue', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro.start()

    await cues.outro()

    expect(warnSpy).toHaveBeenCalledWith(
      '[screenci] Cue "intro" was started with .start() and auto-ended when cue "outro" started. Call .end() explicitly before starting the next narration cue.'
    )
  })

  it('does not warn when a callable cue is followed by another cue', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro()
    await cues.outro.start()

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('end() throws after a callable cue run has completed', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro()

    await expect(cues.intro.end()).rejects.toThrow(
      'Cannot call end() for cue "intro" because it is not the active started cue'
    )
  })

  it('throws when a cue name is reused in one recording', async () => {
    const first = createNarration({
      voice: { name: voices.Ava },
      en: { intro: 'First intro' },
    })
    const second = createNarration({
      voice: { name: voices.Ava },
      en: { intro: 'Second intro' },
    })

    await first.intro.start()
    await expect(second.intro.start()).rejects.toThrow(
      'Duplicate cue name "intro" in one video recording'
    )
  })

  it('throws during createNarration when an ElevenLabs voice is configured without ELEVENLABS_API_KEY', () => {
    delete process.env.ELEVENLABS_API_KEY

    expect(() =>
      createNarration({
        voice: {
          name: voices.elevenlabs({ voiceId: 'tMvyQtpCVQ0DkixuYm6J' }),
        },
        en: {
          intro: 'Hello world',
        },
      })
    ).toThrow(
      'createNarration(en) uses an ElevenLabs voice, but ELEVENLABS_API_KEY is not set. Add ELEVENLABS_API_KEY to your env file or process environment. See https://screenci.com/docs/guides/narration-and-localization.'
    )
  })

  it('throws during createNarration when a custom voice ref is configured without ELEVENLABS_API_KEY', () => {
    delete process.env.ELEVENLABS_API_KEY

    expect(() =>
      createNarration({
        voice: { name: { path: './voice.mp3' } },
        en: {
          intro: 'Hello world',
        },
      })
    ).toThrow(
      'createNarration(en) uses an ElevenLabs voice, but ELEVENLABS_API_KEY is not set. Add ELEVENLABS_API_KEY to your env file or process environment. See https://screenci.com/docs/guides/narration-and-localization.'
    )
  })

  it('throws when a video cue name is reused in one recording', async () => {
    const first = createNarration({
      voice: { name: voices.Ava },
      en: { clip: { media: 'cue.ts' } },
    })
    const second = createNarration({
      voice: { name: voices.Ava },
      en: { clip: { media: 'events.ts' } },
    })
    await validateCustomVoiceRefs(fileURLToPath(import.meta.url))

    await runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({
        testFilePath: fileURLToPath(import.meta.url),
      }),
      async () => {
        setActiveCueRecorder(recorder)
        await first.clip.start()
        await expect(second.clip.start()).rejects.toThrow(
          'Duplicate cue name "clip" in one video recording'
        )
      }
    )
  })

  it('isolates active cue state across concurrent runtime contexts', async () => {
    const recorderA = createMockRecorder()
    const recorderB = createMockRecorder()
    const cues = createNarration(singleLangInput)

    await Promise.all([
      runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext(),
        async () => {
          setActiveCueRecorder(recorderA)
          await cues.intro.start()
          await cues.intro.end()
        }
      ),
      runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext(),
        async () => {
          setActiveCueRecorder(recorderB)
          await cues.intro.start()
          await cues.intro.end()
        }
      ),
    ])

    expect(recorderA.addCueStart).toHaveBeenCalledOnce()
    expect(recorderA.addCueEnd).toHaveBeenCalledOnce()
    expect(recorderB.addCueStart).toHaveBeenCalledOnce()
    expect(recorderB.addCueEnd).toHaveBeenCalledOnce()
  })

  it('resolves file cue asset hashes per runtime test context', async () => {
    const tempDirA = mkdtempSync(join(tmpdir(), 'screenci-cue-a-'))
    const tempDirB = mkdtempSync(join(tmpdir(), 'screenci-cue-b-'))

    try {
      writeFileSync(join(tempDirA, 'clip.txt'), 'context-a')
      writeFileSync(join(tempDirB, 'clip.txt'), 'context-b')

      const recorderA = createMockRecorder()
      const recorderB = createMockRecorder()
      const cues = createNarration({
        voice: { name: voices.Ava },
        en: {
          clip: { media: './clip.txt' },
        },
      })

      await Promise.all([
        runWithScreenCIRuntimeContext(
          createScreenCIRuntimeContext({
            testFilePath: join(tempDirA, 'test.screenci.ts'),
          }),
          async () => {
            setActiveCueRecorder(recorderA)
            await cues.clip.start()
          }
        ),
        runWithScreenCIRuntimeContext(
          createScreenCIRuntimeContext({
            testFilePath: join(tempDirB, 'test.screenci.ts'),
          }),
          async () => {
            setActiveCueRecorder(recorderB)
            await cues.clip.start()
          }
        ),
      ])

      const translationsA = (
        recorderA.addVideoCueStart as ReturnType<typeof vi.fn>
      ).mock.calls[0]?.[4] as Record<string, { assetHash: string }>
      const translationsB = (
        recorderB.addVideoCueStart as ReturnType<typeof vi.fn>
      ).mock.calls[0]?.[4] as Record<string, { assetHash: string }>

      expect(translationsA.en.assetHash).not.toBe(translationsB.en.assetHash)
    } finally {
      rmSync(tempDirA, { recursive: true, force: true })
      rmSync(tempDirB, { recursive: true, force: true })
    }
  })

  it('throws when no top-level languages are provided', () => {
    expect(() =>
      createNarration({
        voice: { name: voices.Ava },
      })
    ).toThrow(
      'createNarration requires at least one top-level language such as "en" or "fi"'
    )
  })

  it('throws a migration error for the legacy languages wrapper', () => {
    const legacyInput = {
      voice: { name: voices.Ava },
      languages: {
        en: {
          intro: 'Hello world',
        },
      },
    }

    expect(() =>
      createNarration(
        legacyInput as unknown as Parameters<typeof createNarration>[0]
      )
    ).toThrow(
      'createNarration no longer accepts a top-level "languages" wrapper. Move each language code to the top level, for example { voice, en: {...}, fi: {...} }.'
    )
  })

  it('throws for unsupported top-level keys at runtime', () => {
    const invalidInput = {
      voice: { name: voices.Ava },
      foo: {
        intro: 'Hello world',
      },
    }

    expect(() =>
      createNarration(
        invalidInput as unknown as Parameters<typeof createNarration>[0]
      )
    ).toThrow(
      'createNarration received unsupported top-level key "foo". Use "voice" or a supported language code such as "en" or "fi".'
    )
  })

  it('throws for locale tags at runtime', () => {
    const invalidInput = {
      voice: { name: voices.Ava },
      'en-US': {
        intro: 'Hello world',
      },
    }

    expect(() =>
      createNarration(
        invalidInput as unknown as Parameters<typeof createNarration>[0]
      )
    ).toThrow(
      'createNarration received unsupported top-level key "en-US". Use "voice" or a supported language code such as "en" or "fi".'
    )
  })

  it('throws a migration error for legacy nested cues input', () => {
    const legacyInput = {
      voice: { name: voices.Ava },
      en: {
        cues: { intro: 'Hello world' },
      },
    }

    expect(() =>
      createNarration(
        legacyInput as unknown as Parameters<typeof createNarration>[0]
      )
    ).toThrow(
      'createNarration no longer supports en.cues. Move cue keys directly into en and keep only optional voice metadata alongside them.'
    )
  })

  it('throws a migration error for legacy region metadata', () => {
    const legacyInput = {
      voice: { name: voices.Ava },
      en: {
        region: 'en-US',
        intro: 'Hello world',
      },
    }

    expect(() =>
      createNarration(
        legacyInput as unknown as Parameters<typeof createNarration>[0]
      )
    ).toThrow(
      `createNarration no longer supports en.region. Remove the region override and keep en as the top-level language key.`
    )
  })

  it('keeps createNarration exported', () => {
    const cues = createNarration(singleLangInput)

    expect(cues.intro).toBeDefined()
    expect(typeof cues.intro).toBe('function')
    expect(typeof cues.intro.start).toBe('function')
  })

  it('does not export createVideoCues from the package root', () => {
    expect(
      (screenci as Record<string, unknown>).createVideoCues
    ).toBeUndefined()
  })

  describe('with the default no-op recorder', () => {
    beforeEach(() => setActiveCueRecorder(NOOP_EVENT_RECORDER))

    it('operations are no-ops', async () => {
      const cues = createNarration(singleLangInput)

      await cues.intro.start()
      await cues.intro.end()

      expect(order).toEqual(['sleep', 'sleep'])
    })
  })

  describe('inside hide()', () => {
    it('throws when starting narration inside hide()', async () => {
      const cues = createNarration(singleLangInput)

      await expect(
        hide(async () => {
          await cues.intro.start()
        })
      ).rejects.toThrow('Cannot start narration inside hide()')
    })

    it('throws when calling end() inside hide()', async () => {
      const cues = createNarration(singleLangInput)
      await cues.intro.start()

      await expect(
        hide(async () => {
          await cues.intro.end()
        })
      ).rejects.toThrow('Cannot call end() inside hide()')
    })
  })

  describe('inside speed() and time()', () => {
    it('allows starting narration inside speed()', async () => {
      const cues = createNarration(singleLangInput)

      await speed(0.5, async () => {
        await cues.intro.start()
      })

      expect(recorder.addCueStart).toHaveBeenCalledOnce()
    })

    it('allows ending narration inside time()', async () => {
      const cues = createNarration(singleLangInput)
      await cues.intro.start()

      await time(1000, async () => {
        await cues.intro.end()
      })

      expect(recorder.addCueEnd).toHaveBeenCalledWith('wait')
    })
  })

  describe('with multi-language map', () => {
    const langInput = {
      voice: { name: voices.Ava },
      en: {
        intro: 'Hello world',
        outro: 'Goodbye',
      },
      fi: {
        intro: 'Hei maailma',
        outro: 'Näkemiin',
      },
    }

    it('creates cue controllers for each key', () => {
      const cues = createNarration(langInput)
      expect(typeof cues.intro).toBe('function')
      expect(typeof cues.intro.start).toBe('function')
      expect(typeof cues.outro.end).toBe('function')
    })

    it('start() passes translations to addCueStart', async () => {
      const cues = createNarration(langInput)
      await cues.intro.start()

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

    it('start() emits sleep → cueStart(multilang) sequence', async () => {
      const cues = createNarration(langInput)
      await cues.intro.start()
      expect(order).toEqual(['sleep', 'cueStart(multilang)'])
    })

    it('uses a per-language narration override in translations', async () => {
      const cues = createNarration({
        voice: { name: voices.Ava },
        en: {
          intro: 'Hello world',
        },
        fi: {
          voice: { name: voices.Nora },
          intro: 'Hei maailma',
        },
      })
      await cues.intro.start()

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

    it('passes a per-cue volume to addCueStart and keeps it out of translations', async () => {
      const cues = createNarration({
        voice: { name: voices.Ava },
        en: { intro: { text: 'Hello world', volume: 0.5 } },
        fi: { intro: { text: 'Hei maailma', volume: 0.5 } },
      })
      await cues.intro.start()

      expect(recorder.addCueStart).toHaveBeenCalledWith(
        '',
        'intro',
        undefined,
        {
          en: { text: 'Hello world', voice: voices.Ava },
          fi: { text: 'Hei maailma', voice: voices.Ava },
        },
        0.5
      )
    })

    it('omits the volume arg when no per-cue volume is set', async () => {
      const cues = createNarration({
        voice: { name: voices.Ava },
        en: { intro: 'Hello world' },
      })
      await cues.intro.start()

      const call = (recorder.addCueStart as ReturnType<typeof vi.fn>).mock
        .calls[0]
      expect(call).toHaveLength(4)
    })

    it('rejects a per-cue volume above the maximum level', () => {
      expect(() =>
        createNarration({
          voice: { name: voices.Ava },
          en: { intro: { text: 'Hello world', volume: 99 } },
        })
      ).toThrow(/finite volume between 0 and 4/)
    })

    it('includes numeric pacing for consistent narration translations', async () => {
      const cues = createNarration({
        voice: {
          name: voices.Ava,
          modelType: modelTypes.consistent,
          pacing: 1.25,
        },
        en: {
          intro: 'Hello world',
        },
      })
      await cues.intro.start()

      expect(recorder.addCueStart).toHaveBeenCalledWith(
        '',
        'intro',
        undefined,
        {
          en: {
            text: 'Hello world',
            voice: voices.Ava,
            modelType: modelTypes.consistent,
            pacing: 1.25,
          },
        }
      )
    })

    it('defaults the top-level voice to Sophie when omitted', async () => {
      const cues = createNarration({
        en: {
          intro: 'Hello world',
        },
        es: {
          intro: 'Hola mundo',
        },
      })
      await cues.intro.start()

      expect(recorder.addCueStart).toHaveBeenCalledWith(
        '',
        'intro',
        undefined,
        {
          en: { text: 'Hello world', voice: voices.Sophie },
          es: { text: 'Hola mundo', voice: voices.Sophie },
        }
      )
      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Sophie',
      })
      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('es', {
        name: 'Sophie',
      })
    })

    it('supports cue objects with text and media fields', async () => {
      const cues = createNarration({
        voice: { name: voices.Ava },
        en: {
          intro: {
            media: '/tmp/intro-en.mp4',
            subtitle: 'Intro subtitle',
          },
        },
        fi: {
          intro: { text: 'Hei maailma' },
        },
      })

      await expect(cues.intro.start()).rejects.toThrow(
        'Asset file not found: /tmp/intro-en.mp4'
      )
    })

    it('allows custom voice refs before validation and resolves them at start', async () => {
      process.env.ELEVENLABS_API_KEY = 'test-elevenlabs-key'
      const tempDir = mkdtempSync(join(tmpdir(), 'screenci-voice-'))

      try {
        writeFileSync(join(tempDir, 'olli-sample.mp3'), 'voice-bytes')

        const customVoice = {
          path: './olli-sample.mp3',
        } as CustomVoiceRef
        const cues = createNarration({
          voice: { name: voices.Ava },
          en: {
            intro: 'Hello world',
          },
          fi: {
            voice: { name: customVoice },
            intro: 'Hei maailma',
          },
        })

        await runWithScreenCIRuntimeContext(
          createScreenCIRuntimeContext({
            testFilePath: join(tempDir, 'test.screenci.ts'),
          }),
          async () => {
            setActiveCueRecorder(recorder)
            await cues.intro.start()
          }
        )

        expect(recorder.addCueStart).toHaveBeenCalledWith(
          '',
          'intro',
          undefined,
          {
            en: { text: 'Hello world', voice: voices.Ava },
            fi: {
              text: 'Hei maailma',
              voice: {
                assetHash: expect.any(String),
                assetPath: './olli-sample.mp3',
              },
            },
          }
        )
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })

  describe('voice metadata registration', () => {
    it('registers voice meta via recorder on start()', async () => {
      const cues = createNarration({
        voice: { name: voices.Ava },
        en: { intro: 'Hello' },
      })
      await cues.intro.start()

      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
      })
    })

    it('per-language override seed is registered', async () => {
      const cues = createNarration({
        voice: { name: voices.Ava },
        en: { intro: 'Hello' },
        fi: {
          voice: { name: voices.Nora, seed: 42 },
          intro: 'Hei',
        },
      })
      await cues.intro.start()

      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
      })
      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('fi', {
        name: 'Nora',
        seed: 42,
      })
    })

    it('registers base language keys as-is', async () => {
      const cues = createNarration({
        voice: { name: voices.Ava },
        en: { intro: 'Hello' },
      })
      await cues.intro.start()

      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
      })
    })
  })

  describe('runtime voice registration (via recorder)', () => {
    it('allows different voices for the same language across cues', async () => {
      const cues1 = createNarration({
        voice: { name: voices.Ava },
        en: { intro: 'Hello' },
      })
      const cues2 = createNarration({
        voice: { name: voices.Aria },
        en: { other: 'World' },
      })

      await cues1.intro.start()
      await expect(cues2.other.start()).resolves.toBeUndefined()
    })

    it('does not throw when two createNarration calls use the same voice for a language', async () => {
      const cues1 = createNarration({
        voice: { name: voices.Ava },
        en: { intro: 'Hello' },
      })
      const cues2 = createNarration({
        voice: { name: voices.Ava },
        en: { other: 'World' },
      })

      await expect(cues1.intro.start()).resolves.toBeUndefined()
      await expect(cues2.other.start()).resolves.toBeUndefined()
    })
  })
})

describe('createStudioNarration', () => {
  let recorder: IEventRecorder
  let order: string[]

  beforeEach(() => {
    order = []
    recorder = createMockRecorder()
    resetCueChain()
    ;(
      recorder.addStudioCueStart as ReturnType<typeof vi.fn>
    ).mockImplementation((name: string) =>
      order.push(`studioCueStart(${name})`)
    )
    ;(recorder.addCueEnd as ReturnType<typeof vi.fn>).mockImplementation(() =>
      order.push('cueEnd')
    )
    setSleepFn(() => order.push('sleep'))
    setActiveCueRecorder(recorder)
  })

  afterEach(() => {
    setActiveCueRecorder(NOOP_EVENT_RECORDER)
    setSleepFn((ms) => {
      const end = performance.now() + ms
      while (performance.now() < end) {}
    })
  })

  it('exposes callable cues with start() and end() for each key', () => {
    const cues = createStudioNarration('intro', 'outro')

    expect(typeof cues.intro).toBe('function')
    expect(typeof cues.intro.start).toBe('function')
    expect(typeof cues.intro.end).toBe('function')
    expect(typeof cues.outro).toBe('function')
  })

  it('throws on duplicate cue keys', () => {
    expect(() => createStudioNarration('intro', 'intro')).toThrow(
      'Duplicate cue key "intro"'
    )
  })

  it('start() emits a studio cue start without text or translations', async () => {
    const cues = createStudioNarration('intro')

    await cues.intro.start()
    expect(order).toEqual(['sleep', 'studioCueStart(intro)'])
    expect(recorder.addCueStart).not.toHaveBeenCalled()
  })

  it('calling a cue runs one start and one end for a single run', async () => {
    const cues = createStudioNarration('intro')

    await cues.intro()
    expect(order).toEqual([
      'sleep',
      'studioCueStart(intro)',
      'sleep',
      'cueEnd',
      'sleep',
    ])
  })

  it('auto-ends the previous cue when the next one starts', async () => {
    const cues = createStudioNarration('intro', 'outro')

    await cues.intro.start()
    await cues.outro.start()
    expect(order).toEqual([
      'sleep',
      'studioCueStart(intro)',
      'cueEnd',
      'sleep',
      'sleep',
      'studioCueStart(outro)',
    ])
  })

  it('enforces unique cue names across the recording', async () => {
    const studio = createStudioNarration('intro')
    const regular = createNarration({
      voice: { name: voices.Ava },
      en: { intro: 'Hello' },
    })

    await studio.intro.start()
    await expect(regular.intro.start()).rejects.toThrow(
      'Duplicate cue name "intro"'
    )
  })

  it('throws when started inside hide()', async () => {
    setActiveHideRecorder(recorder)
    const cues = createStudioNarration('intro')

    await hide(async () => {
      await expect(cues.intro.start()).rejects.toThrow(
        'Cannot start narration inside hide()'
      )
    })
  })
})
