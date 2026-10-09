import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fileURLToPath } from 'url'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  createNarration,
  buildStudioNarrationCues,
  setActiveCueRecorder,
  resetCueChain,
  setSleepFn,
  setCueDurationFetchDeps,
  validateCustomVoiceRefs,
  assertNarrationLanguagesMatch,
  resetMissingNarrationAssetWarnings,
  CUE_BETWEEN_PAUSE_MS,
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
  setActiveScreenCIRuntimeContext,
} from './runtimeContext.js'

function createMockRecorder(): IEventRecorder {
  return {
    start: vi.fn(),
    setActiveLanguage: vi.fn(),
    setAvailableLanguages: vi.fn(),
    addInput: vi.fn(),
    addCueStart: vi.fn(),
    addStudioCueStart: vi.fn(),
    addCueEnd: vi.fn(),
    addCueProgress: vi.fn(),
    addVideoCueStart: vi.fn(),
    addAssetStart: vi.fn(),
    addHideStart: vi.fn(),
    addHideEnd: vi.fn(),
    addSpeedStart: vi.fn(),
    addSpeedEnd: vi.fn(),
    addTimeStart: vi.fn(),
    addTimeEnd: vi.fn(),
    addSleep: vi.fn(),
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
    ;(recorder.addCueProgress as ReturnType<typeof vi.fn>).mockImplementation(
      (name: string, fraction: number) =>
        order.push(`cueProgress(${name},${fraction})`)
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

  it("until('50%') starts the cue, then records a progress mark and keeps the cue open", async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro.until('50%')

    expect(recorder.addCueStart).toHaveBeenCalledTimes(1)
    expect(recorder.addCueStart).toHaveBeenCalledWith(
      '',
      'intro',
      undefined,
      expect.anything()
    )
    // Frame gap before cueStart, frame gap so the mark never shares the
    // cueStart instant, then the mark. No cueEnd: the cue stays open.
    expect(order).toEqual([
      'sleep',
      'cueStart(multilang)',
      'sleep',
      'cueProgress(intro,0.5)',
    ])
  })

  it('until() on an already started cue does not start it again', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro.start()
    await cues.intro.until('40%')
    await cues.intro.until('80%')
    await cues.intro.end()

    expect(recorder.addCueStart).toHaveBeenCalledTimes(1)
    expect(recorder.addCueProgress).toHaveBeenNthCalledWith(1, 'intro', 0.4)
    expect(recorder.addCueProgress).toHaveBeenNthCalledWith(2, 'intro', 0.8)
    expect(recorder.addCueEnd).toHaveBeenCalledWith('wait')
  })

  it('the next cue auto-ends a cue opened by until() without a warning', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro.until('50%')
    await cues.outro()

    expect(recorder.addCueEnd).toHaveBeenNthCalledWith(1, 'auto')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('until() auto-ends another open cue before starting its own', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro.start()
    await cues.outro.until('50%')

    expect(recorder.addCueEnd).toHaveBeenCalledWith('auto')
    expect(recorder.addCueStart).toHaveBeenCalledTimes(2)
    expect(recorder.addCueProgress).toHaveBeenCalledWith('outro', 0.5)
  })

  it('until() percentages on one cue must increase', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro.until('80%')
    await expect(cues.intro.until('50%')).rejects.toThrow(
      /must be later than the previous \.until\(\) on this cue \(80%\)/
    )
    await expect(cues.intro.until('80%')).rejects.toThrow(/must be later/)
    expect(recorder.addCueProgress).toHaveBeenCalledTimes(1)
  })

  it('until() after the cue ended throws instead of restarting it', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro.until('50%')
    await cues.outro.start()
    await expect(cues.intro.until('80%')).rejects.toThrow(
      /was called after the cue ended/
    )
    expect(recorder.addCueStart).toHaveBeenCalledTimes(2)
  })

  it('until() accepts 100%', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro.until('100%')

    expect(recorder.addCueProgress).toHaveBeenCalledWith('intro', 1)
  })

  it.each([
    ['0:05', /percentage of the line's audio such as '50%', got '0:05'/],
    ['soon', /got 'soon'/],
    ['0%', /between 0% \(exclusive\) and 100%/],
    ['150%', /between 0% \(exclusive\) and 100%/],
  ])('until(%j) is rejected before anything is recorded', async (arg, re) => {
    const cues = createNarration(singleLangInput)

    await expect(cues.intro.until(arg as `${number}%`)).rejects.toThrow(re)
    expect(recorder.addCueStart).not.toHaveBeenCalled()
  })

  it('until() rejects a number', async () => {
    const cues = createNarration(singleLangInput)

    await expect(
      cues.intro.until(500 as unknown as `${number}%`)
    ).rejects.toThrow(/got number/)
  })

  it('until() inside hide() throws', async () => {
    const cues = createNarration(singleLangInput)
    setActiveHideRecorder(recorder)

    await expect(
      hide(async () => {
        await cues.intro.until('50%')
      })
    ).rejects.toThrow('Cannot call until() inside hide()')
  })

  it('does not pass an anchor for a plain (no-arg) cue call', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro()

    expect(recorder.addCueStart).toHaveBeenCalledWith(
      '',
      'intro',
      undefined,
      expect.anything()
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

  it('does not require a local ElevenLabs key: the app-stored key is used at render', () => {
    delete process.env.ELEVENLABS_API_KEY

    // The ElevenLabs key lives only in the app (encrypted); the SDK neither reads
    // nor requires ELEVENLABS_API_KEY, so configuring an ElevenLabs voice never
    // throws or warns locally.
    expect(() =>
      createNarration({
        voice: {
          name: voices.elevenlabs({ voiceId: 'tMvyQtpCVQ0DkixuYm6J' }),
        },
        en: { intro: 'Hello world' },
      })
    ).not.toThrow()
    expect(warnSpy).not.toHaveBeenCalled()
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

    it('start({ delay }) passes the delay as the trailing recorder arg', async () => {
      const cues = createNarration(langInput)
      await cues.intro.start({ delay: 500 })

      expect(recorder.addCueStart).toHaveBeenCalledWith(
        '',
        'intro',
        undefined,
        {
          en: { text: 'Hello world', voice: voices.Ava },
          fi: { text: 'Hei maailma', voice: voices.Ava },
        },
        undefined,
        undefined,
        500
      )
    })

    it('start() rejects an invalid delay', async () => {
      const cues = createNarration(langInput)
      await expect(cues.intro.start({ delay: -1 })).rejects.toThrow(/delay/)
      expect(recorder.addCueStart).not.toHaveBeenCalled()
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

    it('defaults the top-level voice to Ava when omitted', async () => {
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
          en: { text: 'Hello world', voice: voices.Ava },
          es: { text: 'Hola mundo', voice: voices.Ava },
        }
      )
      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('en', {
        name: 'Ava',
      })
      expect(recorder.registerVoiceForLang).toHaveBeenCalledWith('es', {
        name: 'Ava',
      })
    })

    it('supports cue objects with text and media fields', async () => {
      resetMissingNarrationAssetWarnings()
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
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

      // The media file is missing locally, so it is recorded without a hash
      // (recovered from a previous upload at upload time) rather than failing.
      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          testFilePath: fileURLToPath(import.meta.url),
        }),
        async () => {
          setActiveCueRecorder(recorder)
          await expect(cues.intro.start()).resolves.toBeUndefined()
        }
      )

      const translations = (
        recorder.addVideoCueStart as ReturnType<typeof vi.fn>
      ).mock.calls[0]?.[4] as Record<string, unknown>
      expect(translations.en).toEqual({
        assetPath: '/tmp/intro-en.mp4',
        subtitle: 'Intro subtitle',
      })
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Locally missing narration media: /tmp/intro-en.mp4'
        )
      )
      infoSpy.mockRestore()
    })

    it('puts clip and source trim inside the video cue translation', async () => {
      resetMissingNarrationAssetWarnings()
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
      const cues = createNarration({
        voice: { name: voices.Ava },
        en: {
          intro: {
            media: '/tmp/intro-trim.mp4',
            clip: { x: 4, y: 8, width: 120, height: 90 },
            start: 1000,
            end: '90%',
          },
        },
      })

      await runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({
          testFilePath: fileURLToPath(import.meta.url),
        }),
        async () => {
          setActiveCueRecorder(recorder)
          await expect(cues.intro.start()).resolves.toBeUndefined()
        }
      )

      const translations = (
        recorder.addVideoCueStart as ReturnType<typeof vi.fn>
      ).mock.calls[0]?.[4] as Record<string, unknown>
      expect(translations.en).toEqual({
        assetPath: '/tmp/intro-trim.mp4',
        clip: { x: 4, y: 8, width: 120, height: 90 },
        sourceStart: { ms: 1000 },
        sourceEnd: { percent: 0.9 },
      })
      warnSpy.mockRestore()
    })

    it('allows custom voice refs before validation and resolves them at start', async () => {
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

    it('records a path-only ref and notes when a custom voice sample is missing locally', async () => {
      resetMissingNarrationAssetWarnings()
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})

      // Sample file does not exist locally (e.g. gitignored on CI). The clone is
      // recovered from a previous upload at upload time, so recording must not fail.
      const customVoice = {
        path: './missing-voice-sample.mp3',
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
          testFilePath: fileURLToPath(import.meta.url),
        }),
        async () => {
          setActiveCueRecorder(recorder)
          await expect(cues.intro.start()).resolves.toBeUndefined()
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
              assetPath: './missing-voice-sample.mp3',
            },
          },
        }
      )
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Locally missing narration media: ./missing-voice-sample.mp3'
        )
      )
      infoSpy.mockRestore()
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

describe('buildStudioNarrationCues', () => {
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

  it('exposes callable cues with start() and end() for each name', () => {
    const cues = buildStudioNarrationCues(['intro', 'outro'])

    expect(typeof cues.intro).toBe('function')
    expect(typeof cues.intro!.start).toBe('function')
    expect(typeof cues.intro!.end).toBe('function')
    expect(typeof cues.outro).toBe('function')
  })

  it('start() emits a studio cue start without text or translations', async () => {
    const cues = buildStudioNarrationCues(['intro'])

    await cues.intro!.start()
    expect(order).toEqual(['sleep', 'studioCueStart(intro)'])
    expect(recorder.addCueStart).not.toHaveBeenCalled()
  })

  it('calling a cue runs one start and one end for a single run', async () => {
    const cues = buildStudioNarrationCues(['intro'])

    await cues.intro!()
    expect(order).toEqual([
      'sleep',
      'studioCueStart(intro)',
      'sleep',
      'cueEnd',
      'sleep',
    ])
  })

  it('auto-ends the previous cue when the next one starts', async () => {
    const cues = buildStudioNarrationCues(['intro', 'outro'])

    await cues.intro!.start()
    await cues.outro!.start()
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
    const studio = buildStudioNarrationCues(['intro'])
    const regular = createNarration({
      voice: { name: voices.Ava },
      en: { intro: 'Hello' },
    })

    await studio.intro!.start()
    await expect(regular.intro.start()).rejects.toThrow(
      'Duplicate cue name "intro"'
    )
  })

  it('throws when started inside hide()', async () => {
    setActiveHideRecorder(recorder)
    const cues = buildStudioNarrationCues(['intro'])

    await hide(async () => {
      await expect(cues.intro!.start()).rejects.toThrow(
        'Cannot start narration inside hide()'
      )
    })
  })
})

describe('assertNarrationLanguagesMatch', () => {
  it('passes when the input languages match the declared set exactly', () => {
    expect(() =>
      assertNarrationLanguagesMatch(
        { voice: { name: 'Ava' }, en: {}, fi: {} },
        ['en', 'fi']
      )
    ).not.toThrow()
  })

  it('ignores the reserved voice key', () => {
    expect(() =>
      assertNarrationLanguagesMatch({ voice: {}, en: {} }, ['en'])
    ).not.toThrow()
  })

  it('throws when a declared language is missing', () => {
    expect(() =>
      assertNarrationLanguagesMatch({ en: {} }, ['en', 'fi'])
    ).toThrow(/missing fi/)
  })

  it('throws when an unexpected language is present', () => {
    expect(() =>
      assertNarrationLanguagesMatch({ en: {}, de: {} }, ['en'])
    ).toThrow(/unexpected de/)
  })
})

describe('exact cue-audio pacing', () => {
  let recorder: IEventRecorder
  let sleeps: number[]
  let originalEnv: NodeJS.ProcessEnv
  let now: number

  beforeEach(() => {
    originalEnv = { ...process.env }
    process.env.SCREENCI_RECORDING = 'true'
    process.env.SCREENCI_SECRET = 'test-secret'
    now = 100_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    sleeps = []
    recorder = createMockRecorder()
    setSleepFn((ms) => {
      sleeps.push(ms)
      now += ms
    })
    setActiveScreenCIRuntimeContext(
      createScreenCIRuntimeContext({
        recorder,
        activeLanguage: 'en',
        recordOptions: { actualNarrationPace: true },
      })
    )
    setCueDurationFetchDeps({
      fetchFn: (async () =>
        Response.json({
          durations: [
            { name: 'intro', inputHash: 'h1', durationMs: 2000 },
            { name: 'outro', inputHash: 'h2', durationMs: null },
          ],
        })) as unknown as typeof fetch,
      readFile: async () => {
        throw new Error('no cache')
      },
      writeFile: async () => {},
      mkdir: async () => undefined,
    })
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
    setCueDurationFetchDeps(undefined)
    setActiveScreenCIRuntimeContext(null)
    setActiveCueRecorder(NOOP_EVENT_RECORDER)
    setSleepFn((ms) => {
      const end = performance.now() + ms
      while (performance.now() < end) {}
    })
  })

  it('sleeps the audio duration plus the inter-cue pause, recorded as cueAudio', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro()

    // Remainder is measured from cueStart: with the mocked clock only the
    // in-block frame-gap sleep elapses before the cue end.
    const frameGapMs = 2 * (1000 / 24)
    const expectedRemainder = 2000 + CUE_BETWEEN_PAUSE_MS - frameGapMs
    expect(recorder.addSleep).toHaveBeenCalledWith(
      expect.closeTo(expectedRemainder, 5),
      'cueAudio'
    )
    expect(sleeps.some((ms) => ms > 1000)).toBe(true)
  })

  it("until('50%') sleeps to that fraction of the audio before the mark (no pause)", async () => {
    const cues = createNarration(singleLangInput)
    const calls: string[] = []
    ;(recorder.addSleep as ReturnType<typeof vi.fn>).mockImplementation(
      (ms: number, reason: string) => calls.push(`${reason}:${Math.round(ms)}`)
    )
    ;(recorder.addCueProgress as ReturnType<typeof vi.fn>).mockImplementation(
      (name: string, fraction: number) =>
        calls.push(`cueProgress:${name}:${fraction}`)
    )
    ;(recorder.addCueEnd as ReturnType<typeof vi.fn>).mockImplementation(
      (reason: string) => calls.push(`cueEnd:${reason}`)
    )

    await cues.intro.until('50%')
    await cues.intro.until('75%')
    await cues.intro.end()

    // 2000ms audio: 50% -> 1000 after cueStart, 75% -> 500 more, end() sleeps
    // the remaining audio plus the inter-cue pause (2000 + 500 - 1500).
    expect(calls).toEqual([
      'frameGap:83',
      'cueAudio:1000',
      'cueProgress:intro:0.5',
      'cueAudio:500',
      'cueProgress:intro:0.75',
      'cueAudio:1000',
      'cueEnd:wait',
      'frameGap:83',
    ])
  })

  it('until() falls back to a frame gap when the duration is unknown', async () => {
    const cues = createNarration(singleLangInput)

    await cues.outro.until('50%')

    expect(recorder.addSleep).not.toHaveBeenCalledWith(
      expect.anything(),
      'cueAudio'
    )
    expect(recorder.addSleep).toHaveBeenLastCalledWith(
      expect.closeTo(2 * (1000 / 24), 1),
      'frameGap'
    )
    expect(recorder.addCueProgress).toHaveBeenCalledWith('outro', 0.5)
  })

  it('until() after start({ delay }) measures from the delayed start', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro.start({ delay: 400 })
    await cues.intro.until('50%')
    await cues.intro.end()

    // Audio starts 400ms after the call: 50% of 2000ms is 1400ms away, and
    // end() then sleeps the rest of the line plus the pause (1000 + 500).
    expect(recorder.addSleep).toHaveBeenCalledWith(1400, 'cueAudio')
    expect(recorder.addSleep).toHaveBeenCalledWith(1500, 'cueAudio')
  })

  it('until() past an already elapsed fraction only adds a frame gap', async () => {
    const cues = createNarration(singleLangInput)

    await cues.intro.start()
    now += 1500
    await cues.intro.until('50%')

    expect(recorder.addSleep).not.toHaveBeenCalledWith(
      expect.anything(),
      'cueAudio'
    )
    expect(recorder.addCueProgress).toHaveBeenCalledWith('intro', 0.5)
  })

  it('falls back to frame gaps when the duration is unknown (null)', async () => {
    const cues = createNarration(singleLangInput)

    await cues.outro()

    expect(recorder.addSleep).not.toHaveBeenCalledWith(
      expect.anything(),
      'cueAudio'
    )
  })

  it('skips pacing when actualNarrationPace is off (the default)', async () => {
    setActiveScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ recorder, activeLanguage: 'en' })
    )
    const cues = createNarration(singleLangInput)

    await cues.intro()

    expect(recorder.addSleep).not.toHaveBeenCalledWith(
      expect.anything(),
      'cueAudio'
    )
  })

  it('skips pacing in shared mode (no active language)', async () => {
    setActiveScreenCIRuntimeContext(
      createScreenCIRuntimeContext({
        recorder,
        activeLanguage: null,
        recordOptions: { actualNarrationPace: true },
      })
    )
    const cues = createNarration(singleLangInput)

    await cues.intro()

    expect(recorder.addSleep).not.toHaveBeenCalledWith(
      expect.anything(),
      'cueAudio'
    )
  })

  it('falls back to frame gaps when the duration fetch fails', async () => {
    setCueDurationFetchDeps({
      fetchFn: (async () => {
        throw new Error('offline')
      }) as unknown as typeof fetch,
      readFile: async () => {
        throw new Error('no cache')
      },
      writeFile: async () => {},
      mkdir: async () => undefined,
    })
    const cues = createNarration(singleLangInput)

    await cues.intro()

    expect(recorder.addSleep).not.toHaveBeenCalledWith(
      expect.anything(),
      'cueAudio'
    )
  })
})
