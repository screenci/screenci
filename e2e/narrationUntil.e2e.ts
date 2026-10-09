import { test, expect } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

import { instrumentPage, setActiveClickRecorder } from '../src/instrument.js'
import { EventRecorder, type RecordingEvent } from '../src/events.js'
import {
  createNarration,
  setCueDurationFetchDeps,
  setActiveCueRecorder,
} from '../src/cue.js'
import {
  createScreenCIRuntimeContext,
  setActiveScreenCIRuntimeContext,
} from '../src/runtimeContext.js'
import { voices } from '../src/voices.js'

// narration.x.until('<n>%') against a real page, recorder, and click
// instrumentation: the recorded stream must carry the mark between the cue
// start and the click, which is what the renderer turns into a mid-line hold.

const PAGE_HTML = `
  <style>body { margin: 0 } #save { position: absolute; top: 120px; left: 160px; }</style>
  <button id="save" onclick="this.textContent = 'Saved'">Save</button>
`

const LINE_MS = 1600

function only<T extends RecordingEvent['type']>(
  events: RecordingEvent[],
  type: T
): Extract<RecordingEvent, { type: T }>[] {
  return events.filter(
    (e): e is Extract<RecordingEvent, { type: T }> => e.type === type
  )
}

function dumpForRenderer(name: string, events: RecordingEvent[]): void {
  // Kept for the cross-package check (SDK stream -> renderer timing).
  const dir = join('test-results', 'narration-until')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ events }, null, 2))
}

let recorder: EventRecorder

test.beforeEach(async ({ page }) => {
  await instrumentPage(page)
  await page.setContent(PAGE_HTML)
  recorder = new EventRecorder()
  recorder.start()
  setActiveClickRecorder(recorder)
  setActiveCueRecorder(recorder)
})

test.afterEach(() => {
  setActiveClickRecorder(null)
  setActiveCueRecorder(null)
  setActiveScreenCIRuntimeContext(null)
  setCueDurationFetchDeps(undefined)
})

test('fast mode: records start, mark, click, end in order', async ({
  page,
}) => {
  const narration = createNarration({
    voice: { name: voices.Ava },
    en: { save: 'Save the changes when you are ready.' },
  })

  await narration.save.until('50%')
  await page.locator('#save').click()
  await narration.save.end()

  await expect(page.locator('#save')).toHaveText('Saved')
  const events = recorder.getEvents()
  dumpForRenderer('fast', events)

  const [start] = only(events, 'cueStart')
  const [progress] = only(events, 'cueProgress')
  const [end] = only(events, 'cueEnd')
  const click = only(events, 'input').find((e) => e.subType === 'click')
  expect(start).toBeDefined()
  expect(progress).toMatchObject({ name: 'save', fraction: 0.5 })
  expect(end).toMatchObject({ reason: 'wait' })
  expect(click).toBeDefined()

  // The mark sits after the cue start (never on its instant) and before the
  // click, so the render's hold lands between them.
  expect(progress!.timeMs).toBeGreaterThan(start!.timeMs)
  const clickStartMs = Math.min(...click!.events.map((e) => e.startMs))
  expect(clickStartMs).toBeGreaterThanOrEqual(progress!.timeMs)
  expect(end!.timeMs).toBeGreaterThanOrEqual(clickStartMs)
  // Fast mode never sleeps the audio.
  expect(
    only(events, 'sleep').filter((s) => s.reason === 'cueAudio')
  ).toHaveLength(0)
})

test('paced mode: the recording itself waits until half the line', async ({
  page,
}) => {
  const prev = {
    recording: process.env.SCREENCI_RECORDING,
    secret: process.env.SCREENCI_SECRET,
  }
  process.env.SCREENCI_RECORDING = 'true'
  process.env.SCREENCI_SECRET = 'test-secret'
  try {
    setActiveScreenCIRuntimeContext(
      createScreenCIRuntimeContext({
        recorder,
        activeLanguage: 'en',
        recordOptions: { actualNarrationPace: true },
      })
    )
    setActiveClickRecorder(recorder)
    setCueDurationFetchDeps({
      fetchFn: (async () =>
        Response.json({
          durations: [{ name: 'save', durationMs: LINE_MS }],
        })) as unknown as typeof fetch,
      readFile: async () => {
        throw new Error('no cache')
      },
      writeFile: async () => {},
      mkdir: async () => undefined,
    })
    const narration = createNarration({
      voice: { name: voices.Ava },
      en: { save: 'Save the changes when you are ready.' },
    })

    const before = Date.now()
    await narration.save.until('50%')
    const waitedMs = Date.now() - before
    await page.locator('#save').click()
    await narration.save.end()

    const events = recorder.getEvents()
    dumpForRenderer('paced', events)
    const [start] = only(events, 'cueStart')
    const [progress] = only(events, 'cueProgress')
    const audioSleeps = only(events, 'sleep').filter(
      (s) => s.reason === 'cueAudio'
    )

    // Half of the 1600ms line, measured from the cue start.
    expect(progress!.timeMs - start!.timeMs).toBeGreaterThanOrEqual(
      LINE_MS / 2 - 5
    )
    expect(progress!.timeMs - start!.timeMs).toBeLessThan(LINE_MS / 2 + 150)
    expect(waitedMs).toBeGreaterThanOrEqual(LINE_MS / 2 - 5)
    // The fraction sleep ends where the mark is recorded (the renderer's
    // over-sleep trim relies on this). end() sleeps only what is left of the
    // line + pause, which the animated click usually already covered.
    expect(audioSleeps.length).toBeGreaterThanOrEqual(1)
    const first = audioSleeps[0]!
    expect(progress!.timeMs - (first.timeMs + first.durationMs)).toBeLessThan(
      40
    )
  } finally {
    process.env.SCREENCI_RECORDING = prev.recording
    process.env.SCREENCI_SECRET = prev.secret
    if (prev.recording === undefined) delete process.env.SCREENCI_RECORDING
    if (prev.secret === undefined) delete process.env.SCREENCI_SECRET
  }
})
