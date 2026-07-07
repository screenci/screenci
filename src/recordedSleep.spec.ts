import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { performRecordedSleep } from './recordedSleep.js'
import { EventRecorder, NOOP_EVENT_RECORDER } from './events.js'

describe('performRecordedSleep', () => {
  let now = 1000

  beforeEach(() => {
    now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    delete process.env['SCREENCI_DISABLE_RECORDING_TIMINGS']
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sleeps the requested duration and records a sleep event', () => {
    const recorder = new EventRecorder()
    recorder.start()
    const sleepFn = vi.fn((ms: number) => {
      now += ms
    })

    now = 1200
    performRecordedSleep(recorder, 80, 'frameGap', sleepFn)

    expect(sleepFn).toHaveBeenCalledWith(80)
    expect(recorder.getEvents().slice(1)).toEqual([
      { type: 'sleep', timeMs: 200, durationMs: 80, reason: 'frameGap' },
    ])
  })

  it('neither sleeps nor records when recording timings are disabled', () => {
    process.env['SCREENCI_DISABLE_RECORDING_TIMINGS'] = 'true'
    const recorder = new EventRecorder()
    recorder.start()
    const sleepFn = vi.fn()

    performRecordedSleep(recorder, 80, 'frameGap', sleepFn)

    expect(sleepFn).not.toHaveBeenCalled()
    expect(recorder.getEvents()).toHaveLength(1)
    delete process.env['SCREENCI_DISABLE_RECORDING_TIMINGS']
  })

  it('works with the no-op recorder without throwing', () => {
    const sleepFn = vi.fn()
    performRecordedSleep(NOOP_EVENT_RECORDER, 80, 'cueAudio', sleepFn)
    expect(sleepFn).toHaveBeenCalledWith(80)
  })
})
