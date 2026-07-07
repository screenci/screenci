import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { timestamp } from './timestamp.js'
import { EventRecorder, NOOP_EVENT_RECORDER } from './events.js'
import { setActiveHideRecorder } from './hide.js'

describe('EventRecorder.addTimestamp', () => {
  let now = 1000

  beforeEach(() => {
    now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records a named marker at the current recording time', () => {
    const recorder = new EventRecorder()
    recorder.start()
    now = 1500
    recorder.addTimestamp('checkout')

    expect(recorder.getEvents().slice(1)).toEqual([
      { type: 'timestamp', timeMs: 500, name: 'checkout' },
    ])
  })

  it('does nothing before the recording has started', () => {
    const recorder = new EventRecorder()
    recorder.addTimestamp('too-early')
    expect(recorder.getEvents()).toHaveLength(0)
  })
})

describe('timestamp()', () => {
  let now = 1000

  beforeEach(() => {
    now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    setActiveHideRecorder(null)
    vi.restoreAllMocks()
  })

  it('adds a marker to the active recorder', async () => {
    const recorder = new EventRecorder()
    recorder.start()
    setActiveHideRecorder(recorder)

    now = 1250
    await timestamp('opened')

    expect(recorder.getEvents().slice(1)).toEqual([
      { type: 'timestamp', timeMs: 250, name: 'opened' },
    ])
  })

  it('is a no-op when no recorder is active', async () => {
    setActiveHideRecorder(NOOP_EVENT_RECORDER)
    await expect(timestamp('noop')).resolves.toBeUndefined()
  })

  it.each(['', '   '])('rejects an empty name (%j)', async (name) => {
    const recorder = new EventRecorder()
    recorder.start()
    setActiveHideRecorder(recorder)
    await expect(timestamp(name)).rejects.toThrow(
      'timestamp() name must be a non-empty string'
    )
    expect(recorder.getEvents()).toHaveLength(1)
  })
})
