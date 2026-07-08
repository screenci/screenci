import { describe, expect, it, vi } from 'vitest'
import {
  placeHide,
  placeSpeed,
  placeTime,
  placeZoom,
  waitSince,
} from './placed.js'
import type { PlacedEvent } from './timelineEdits.js'
import type { IEventRecorder } from './events.js'
import { NOOP_EVENT_RECORDER } from './events.js'
import {
  createScreenCIRuntimeContext,
  runWithScreenCIRuntimeContext,
} from './runtimeContext.js'

function withRecorder<T>(
  overrides: Partial<IEventRecorder>,
  fn: () => T
): { result: T; placed: PlacedEvent[] } {
  const placed: PlacedEvent[] = []
  const recorder: IEventRecorder = {
    ...NOOP_EVENT_RECORDER,
    addPlacedEvent: (event) => {
      placed.push(event)
    },
    ...overrides,
  }
  const context = createScreenCIRuntimeContext({ recorder })
  const result = runWithScreenCIRuntimeContext(context, fn)
  return { result, placed }
}

describe('placeHide / placeSpeed / placeTime', () => {
  it('records anchored span events with typed anchor refs', () => {
    const { placed } = withRecorder({}, () => {
      placeHide({ from: 'intro', offsetMs: 250, durationMs: 500 })
      placeSpeed({
        from: 'video:start',
        until: { timestamp: 'intro', ordinal: 1 },
        untilOffsetMs: -100,
        multiplier: 3,
      })
      placeTime({
        from: { action: 'input|click|getByRole(button)|0', edge: 'start' },
        durationMs: 2000,
        playsAsMs: 400,
      })
    })
    expect(placed).toHaveLength(3)
    expect(placed[0]).toMatchObject({
      kind: 'hide',
      anchor: {
        ref: { type: 'timestamp', name: 'intro', ordinal: 0 },
        edge: 'start',
        offsetMs: 250,
      },
      end: { durationMs: 500 },
    })
    expect(placed[1]).toMatchObject({
      kind: 'speed',
      anchor: { ref: { type: 'videoStart' }, offsetMs: 0 },
      end: {
        anchor: {
          ref: { type: 'timestamp', name: 'intro', ordinal: 1 },
          offsetMs: -100,
        },
      },
      props: { multiplier: 3 },
    })
    expect(placed[2]).toMatchObject({
      kind: 'time',
      anchor: {
        ref: { type: 'action', key: 'input|click|getByRole(button)|0' },
        edge: 'start',
      },
      end: { durationMs: 2000 },
      props: { durationMs: 400 },
    })
    // Ids are distinct code-prefixed identifiers.
    expect(new Set(placed.map((event) => event.id)).size).toBe(3)
    expect(placed.every((event) => event.id.startsWith('code|'))).toBe(true)
  })

  it('records zoom lead-ins with negative offsets and camera props', () => {
    const { placed } = withRecorder({}, () => {
      placeZoom({
        from: { action: 'input|click|getByRole(button)|0', edge: 'start' },
        offsetMs: -400,
        until: { action: 'input|click|getByRole(button)|0', edge: 'end' },
        untilOffsetMs: 600,
        amount: 0.6,
        duration: 500,
      })
    })
    expect(placed[0]).toMatchObject({
      kind: 'zoom',
      anchor: {
        ref: { type: 'action', key: 'input|click|getByRole(button)|0' },
        edge: 'start',
        offsetMs: -400,
      },
      end: {
        anchor: {
          ref: { type: 'action', key: 'input|click|getByRole(button)|0' },
          edge: 'end',
          offsetMs: 600,
        },
      },
      props: { amount: 0.6, duration: 500 },
    })
  })

  it('action anchors default to the end edge', () => {
    const { placed } = withRecorder({}, () => {
      placeHide({ from: { action: 'delay|||0' }, durationMs: 100 })
    })
    expect(placed[0]?.anchor.edge).toBe('end')
  })

  it('rejects invalid options', () => {
    withRecorder({}, () => {
      expect(() => placeHide({ from: '', durationMs: 100 })).toThrow(
        'non-empty'
      )
      expect(() => placeHide({ from: 'x' })).toThrow('durationMs')
      expect(() => placeHide({ from: 'x', durationMs: -5 })).toThrow(
        'durationMs'
      )
      expect(() =>
        placeTime({ from: 'x', durationMs: 100, playsAsMs: -1 })
      ).toThrow('playsAsMs')
    })
  })
})

describe('waitSince', () => {
  it('waits only the remaining time since the marker', async () => {
    vi.useFakeTimers()
    try {
      const stampedAt = Date.now()
      const { result } = withRecorder(
        {
          getTimestampWallClock: (name) => (name === 'mark' ? stampedAt : null),
        },
        () => {
          vi.advanceTimersByTime(300)
          return waitSince('mark', 800)
        }
      )
      let resolved = false
      void result.then(() => {
        resolved = true
      })
      await vi.advanceTimersByTimeAsync(499)
      expect(resolved).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(resolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns immediately when the marker is already past the offset', async () => {
    const { result } = withRecorder(
      {
        getTimestampWallClock: () => Date.now() - 5000,
      },
      () => waitSince('mark', 800)
    )
    await expect(result).resolves.toBeUndefined()
  })

  it('waits the full duration when the marker is unknown', async () => {
    vi.useFakeTimers()
    try {
      const { result } = withRecorder({}, () => waitSince('missing', 200))
      let resolved = false
      void result.then(() => {
        resolved = true
      })
      await vi.advanceTimersByTimeAsync(199)
      expect(resolved).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(resolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects invalid arguments', async () => {
    withRecorder({}, () => {
      void expect(waitSince('', 100)).rejects.toThrow('non-empty')
      void expect(waitSince('x', -1)).rejects.toThrow('non-negative')
    })
  })
})
