import { describe, expect, it } from 'vitest'
import {
  applyAuthoredEvents,
  parseAuthoredEvents,
  resolveAnchorMs,
  type AuthoredEvent,
} from './authoredEvents.js'

const CLICK = {
  type: 'input',
  subType: 'click',
  events: [
    { type: 'mouseMove', startMs: 1000, endMs: 1900 },
    { type: 'mouseDown', startMs: 1900, endMs: 1950 },
  ],
  editable: {
    descriptor: {
      kind: 'input',
      subKind: 'click',
      matcher: 'getByRole(button)',
      ordinal: 0,
      seq: 0,
    },
    locked: false,
    schemaKind: 'cursorMove',
    defaults: {},
  },
}

const EVENTS = [
  { type: 'videoStart', timeMs: 0 },
  CLICK,
  { type: 'timestamp', timeMs: 3000, name: 'checkout' },
  { type: 'delay', timeMs: 4000, durationMs: 500 },
]

const CLICK_KEY = 'input|click|getByRole(button)|0'

describe('parseAuthoredEvents', () => {
  it('parses valid events and drops malformed ones', () => {
    const valid: AuthoredEvent = {
      id: 'a1',
      kind: 'hide',
      from: { ref: CLICK_KEY, offsetMs: 100 },
      to: { durationMs: 500 },
    }
    const parsed = parseAuthoredEvents({
      SCREENCI_AUTHORED_EVENTS: JSON.stringify({
        'My video': [
          valid,
          { id: 'bad', kind: 'explode', from: valid.from, to: valid.to },
          { id: 'bad2', kind: 'hide', from: { ref: '' }, to: valid.to },
        ],
      }),
    } as NodeJS.ProcessEnv)
    expect(parsed).toEqual({ 'My video': [valid] })
  })

  it('returns null when unset or malformed', () => {
    expect(parseAuthoredEvents({} as NodeJS.ProcessEnv)).toBeNull()
    expect(
      parseAuthoredEvents({
        SCREENCI_AUTHORED_EVENTS: 'nope',
      } as NodeJS.ProcessEnv)
    ).toBeNull()
  })
})

describe('resolveAnchorMs', () => {
  it('resolves editable stable keys with edge and offset', () => {
    expect(resolveAnchorMs(EVENTS, { ref: CLICK_KEY, offsetMs: 0 })).toBe(1000)
    expect(
      resolveAnchorMs(EVENTS, { ref: CLICK_KEY, offsetMs: 250, edge: 'end' })
    ).toBe(2200)
  })

  it('resolves timestamp markers by stable key or bare name', () => {
    expect(
      resolveAnchorMs(EVENTS, { ref: 'timestamp||checkout|0', offsetMs: 10 })
    ).toBe(3010)
    expect(resolveAnchorMs(EVENTS, { ref: 'checkout', offsetMs: -500 })).toBe(
      2500
    )
  })

  it('returns null for unknown refs', () => {
    expect(resolveAnchorMs(EVENTS, { ref: 'missing', offsetMs: 0 })).toBeNull()
  })
})

describe('applyAuthoredEvents', () => {
  it('inserts a hide pair anchored to a click plus offset and duration', () => {
    const warnings: string[] = []
    const result = applyAuthoredEvents(
      EVENTS,
      [
        {
          id: 'h1',
          kind: 'hide',
          from: { ref: CLICK_KEY, offsetMs: 200, edge: 'end' },
          to: { durationMs: 800 },
        },
      ],
      (message) => warnings.push(message)
    ) as Array<{ type: string; timeMs?: number }>
    expect(warnings).toEqual([])
    const hideStart = result.find((event) => event.type === 'hideStart')
    const hideEnd = result.find((event) => event.type === 'hideEnd')
    expect(hideStart?.timeMs).toBe(2150)
    expect(hideEnd?.timeMs).toBe(2950)
    // Sorted: the hide pair lands between the click and the timestamp.
    const types = result.map((event) => event.type)
    expect(types.indexOf('hideStart')).toBeGreaterThan(types.indexOf('input'))
    expect(types.indexOf('hideEnd')).toBeLessThan(types.indexOf('timestamp'))
  })

  it('inserts a speed pair between two anchors with offsets', () => {
    const result = applyAuthoredEvents(EVENTS, [
      {
        id: 's1',
        kind: 'speed',
        from: { ref: CLICK_KEY, offsetMs: 0 },
        to: { anchor: { ref: 'checkout', offsetMs: 500 } },
        props: { multiplier: 4 },
      },
    ]) as Array<{ type: string; timeMs?: number; multiplier?: number }>
    const start = result.find((event) => event.type === 'speedStart')
    const end = result.find((event) => event.type === 'speedEnd')
    expect(start).toMatchObject({ timeMs: 1000, multiplier: 4 })
    expect(end?.timeMs).toBe(3500)
  })

  it('skips events with missing anchors or inverted ranges, with warnings', () => {
    const warnings: string[] = []
    const result = applyAuthoredEvents(
      EVENTS,
      [
        {
          id: 'x1',
          kind: 'hide',
          from: { ref: 'missing', offsetMs: 0 },
          to: { durationMs: 100 },
        },
        {
          id: 'x2',
          kind: 'speed',
          from: { ref: 'checkout', offsetMs: 0 },
          to: { anchor: { ref: CLICK_KEY, offsetMs: 0 } },
        },
      ],
      (message) => warnings.push(message)
    ) as Array<{ type: string }>
    expect(result).toHaveLength(EVENTS.length)
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain("anchor 'missing' not found")
    expect(warnings[1]).toContain('inverted')
  })

  it('clamps ranges to the recording span with a warning', () => {
    const warnings: string[] = []
    const result = applyAuthoredEvents(
      EVENTS,
      [
        {
          id: 'c1',
          kind: 'hide',
          from: { ref: 'checkout', offsetMs: -10000 },
          to: { durationMs: 60000 },
        },
      ],
      (message) => warnings.push(message)
    ) as Array<{ type: string; timeMs?: number }>
    const hideStart = result.find((event) => event.type === 'hideStart')
    const hideEnd = result.find((event) => event.type === 'hideEnd')
    expect(hideStart?.timeMs).toBe(0)
    // Recording ends at the delay's end (4500ms).
    expect(hideEnd?.timeMs).toBe(4500)
    expect(warnings.some((warning) => warning.includes('clamped'))).toBe(true)
  })
})
