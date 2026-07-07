import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventRecorder, NOOP_EVENT_RECORDER } from './events.js'
import type {
  BackgroundUpdateEvent,
  IEventRecorder,
  NarrationUpdateEvent,
  RecordingEvent,
  RecordingUpdateEvent,
} from './events.js'
import {
  hideRecording,
  moveNarration,
  resizeNarration,
  resizeRecording,
  showRecording,
  narrationVisibilityUpdate,
  validateMoveNarration,
  validateTransition,
} from './overlayUpdates.js'

/** Fake recorder capturing update events, injected via the DI parameter. */
function fakeRecorder(): IEventRecorder & { pushed: RecordingEvent[] } {
  const pushed: RecordingEvent[] = []
  return {
    ...NOOP_EVENT_RECORDER,
    pushed,
    addNarrationUpdate(update) {
      pushed.push({ type: 'narrationUpdate', timeMs: 0, ...update })
    },
    addRecordingUpdate(update) {
      pushed.push({ type: 'recordingUpdate', timeMs: 0, ...update })
    },
    addBackgroundUpdate(update) {
      pushed.push({ type: 'backgroundUpdate', timeMs: 0, ...update })
    },
    addNarrationHide() {
      pushed.push({ type: 'narrationHide', timeMs: 0 })
    },
    addNarrationShow() {
      pushed.push({ type: 'narrationShow', timeMs: 0 })
    },
  }
}

describe('validateTransition', () => {
  it('returns undefined without duration', () => {
    expect(validateTransition('x', undefined)).toBeUndefined()
    expect(validateTransition('x', {})).toBeUndefined()
  })

  it('treats duration 0 as instant', () => {
    expect(validateTransition('x', { duration: 0 })).toBeUndefined()
  })

  it('normalizes duration and defaults easing to ease-in-out', () => {
    expect(validateTransition('x', { duration: 600 })).toEqual({
      durationMs: 600,
      easing: 'ease-in-out',
    })
    expect(
      validateTransition('x', { duration: 250, easing: 'linear' })
    ).toEqual({ durationMs: 250, easing: 'linear' })
  })

  it('rejects easing without duration', () => {
    expect(() => validateTransition('x', { easing: 'linear' })).toThrow(
      /easing requires duration/
    )
  })

  it('rejects negative and non-integer durations', () => {
    expect(() => validateTransition('x', { duration: -1 })).toThrow(/duration/)
    expect(() => validateTransition('x', { duration: 1.5 })).toThrow(/duration/)
    expect(() => validateTransition('x', { duration: NaN })).toThrow(/duration/)
  })

  it('rejects unknown easings', () => {
    expect(() =>
      // @ts-expect-error runtime validation of a bad easing name
      validateTransition('x', { duration: 100, easing: 'bounce' })
    ).toThrow(/easing/)
  })
})

describe('validateMoveNarration', () => {
  it('builds a partial-diff payload', () => {
    expect(
      validateMoveNarration('top-left', {
        padding: { x: 0.02, y: 0.06 },
        size: 0.2,
        duration: 600,
      })
    ).toEqual({
      corner: 'top-left',
      padding: { x: 0.02, y: 0.06 },
      size: 0.2,
      transition: { durationMs: 600, easing: 'ease-in-out' },
    })
  })

  it('accepts a single padding axis (uneven padding)', () => {
    expect(
      validateMoveNarration('bottom-left', { padding: { x: 0.1 } })
    ).toEqual({ corner: 'bottom-left', padding: { x: 0.1 } })
  })

  it('rejects an empty padding object', () => {
    expect(() => validateMoveNarration('top-left', { padding: {} })).toThrow(
      /padding/
    )
  })

  it('rejects out-of-range padding', () => {
    expect(() =>
      validateMoveNarration('top-left', { padding: { x: 1.5 } })
    ).toThrow(/padding.x/)
    expect(() =>
      validateMoveNarration('top-left', { padding: { y: -2 } })
    ).toThrow(/padding.y/)
  })

  it('rejects a bad corner', () => {
    // @ts-expect-error runtime validation of a bad corner name
    expect(() => validateMoveNarration('center', {})).toThrow(/corner/)
  })

  it('rejects out-of-range size', () => {
    expect(() => validateMoveNarration('top-left', { size: 0 })).toThrow(/size/)
    expect(() => validateMoveNarration('top-left', { size: 1.2 })).toThrow(
      /size/
    )
  })
})

describe('free functions push events through the recorder', () => {
  it('moveNarration emits a narrationUpdate', async () => {
    const r = fakeRecorder()
    await moveNarration('top-right', { padding: { y: 0.05 } }, r)
    expect(r.pushed).toEqual([
      {
        type: 'narrationUpdate',
        timeMs: 0,
        corner: 'top-right',
        padding: { y: 0.05 },
      } satisfies NarrationUpdateEvent,
    ])
  })

  it('resizeNarration emits a size-only narrationUpdate', async () => {
    const r = fakeRecorder()
    await resizeNarration(0.15, { duration: 400, easing: 'ease-out' }, r)
    expect(r.pushed).toEqual([
      {
        type: 'narrationUpdate',
        timeMs: 0,
        size: 0.15,
        transition: { durationMs: 400, easing: 'ease-out' },
      } satisfies NarrationUpdateEvent,
    ])
  })

  it('resizeRecording accepts size 0 and 1', async () => {
    const r = fakeRecorder()
    await resizeRecording(0, undefined, r)
    await resizeRecording(1, undefined, r)
    expect(r.pushed).toHaveLength(2)
  })

  it('hideRecording / showRecording emit visibility recordingUpdates', async () => {
    const r = fakeRecorder()
    await hideRecording({ duration: 300 }, r)
    await showRecording(undefined, r)
    expect(r.pushed).toEqual([
      {
        type: 'recordingUpdate',
        timeMs: 0,
        visible: false,
        transition: { durationMs: 300, easing: 'ease-in-out' },
      } satisfies RecordingUpdateEvent,
      {
        type: 'recordingUpdate',
        timeMs: 0,
        visible: true,
      } satisfies RecordingUpdateEvent,
    ])
  })

  it('narrationVisibilityUpdate keeps legacy events for instant hide/show', () => {
    const r = fakeRecorder()
    narrationVisibilityUpdate('hideNarration', false, undefined, r)
    narrationVisibilityUpdate('showNarration', true, undefined, r)
    expect(r.pushed.map((e) => e.type)).toEqual([
      'narrationHide',
      'narrationShow',
    ])
  })

  it('narrationVisibilityUpdate emits narrationUpdate for fades', () => {
    const r = fakeRecorder()
    narrationVisibilityUpdate('hideNarration', false, { duration: 250 }, r)
    expect(r.pushed).toEqual([
      {
        type: 'narrationUpdate',
        timeMs: 0,
        visible: false,
        transition: { durationMs: 250, easing: 'ease-in-out' },
      } satisfies NarrationUpdateEvent,
    ])
  })
})

describe('EventRecorder update methods', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function startedRecorder(): EventRecorder {
    const r = new EventRecorder()
    r.start()
    return r
  }

  it('stamps recording-relative timeMs and exact shapes', () => {
    const r = startedRecorder()
    vi.setSystemTime(1500)
    r.addNarrationUpdate({ corner: 'top-left', size: 0.2 })
    vi.setSystemTime(3000)
    r.addRecordingUpdate({ size: 0.6 })
    vi.setSystemTime(4000)
    r.addBackgroundUpdate({ background: { backgroundCss: '#000' } })
    const events = r.getEvents()
    expect(events).toContainEqual({
      type: 'narrationUpdate',
      timeMs: 1500,
      corner: 'top-left',
      size: 0.2,
    } satisfies NarrationUpdateEvent)
    expect(events).toContainEqual({
      type: 'recordingUpdate',
      timeMs: 3000,
      size: 0.6,
    } satisfies RecordingUpdateEvent)
    expect(events).toContainEqual({
      type: 'backgroundUpdate',
      timeMs: 4000,
      background: { backgroundCss: '#000' },
    } satisfies BackgroundUpdateEvent)
  })

  it('rejects an update at the same time as the previous one on the target', () => {
    const r = startedRecorder()
    vi.setSystemTime(1000)
    r.addNarrationUpdate({ size: 0.2 })
    expect(() => r.addNarrationUpdate({ corner: 'top-left' })).toThrow(
      /overlaps the previous update/
    )
  })

  it('rejects an update inside the previous transition window', () => {
    const r = startedRecorder()
    vi.setSystemTime(1000)
    r.addNarrationUpdate({
      size: 0.2,
      transition: { durationMs: 500, easing: 'linear' },
    })
    vi.setSystemTime(1400)
    expect(() => r.addNarrationUpdate({ size: 0.3 })).toThrow(
      /transition runs until 1500ms/
    )
    vi.setSystemTime(1501)
    r.addNarrationUpdate({ size: 0.3 })
    expect(
      r.getEvents().filter((e) => e.type === 'narrationUpdate')
    ).toHaveLength(2)
  })

  it('tracks overlap per target independently', () => {
    const r = startedRecorder()
    vi.setSystemTime(1000)
    r.addNarrationUpdate({
      size: 0.2,
      transition: { durationMs: 500, easing: 'linear' },
    })
    // A recording update inside the narration transition is fine.
    r.addRecordingUpdate({ size: 0.5 })
    vi.setSystemTime(1200)
    r.addBackgroundUpdate({ background: { backgroundCss: '#000' } })
    expect(r.getEvents()).toHaveLength(4) // videoStart + 3 updates
  })

  it('NOOP recorder no-ops', () => {
    expect(() => {
      NOOP_EVENT_RECORDER.addNarrationUpdate({ size: 0.2 })
      NOOP_EVENT_RECORDER.addRecordingUpdate({ visible: false })
      NOOP_EVENT_RECORDER.addBackgroundUpdate({
        background: { backgroundCss: '#000' },
      })
    }).not.toThrow()
    expect(NOOP_EVENT_RECORDER.getEvents()).toEqual([])
  })
})
