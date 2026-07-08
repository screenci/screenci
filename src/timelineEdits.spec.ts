import { describe, expect, it } from 'vitest'

import type {
  Anchor,
  OverrideReportItem,
  PlacedEvent,
} from './timelineEdits.js'
import {
  OverrideReportBuilder,
  SCREENCI_TIMELINE_EDITS_ENV,
  applyPlacedEvents,
  applyZoomWindowOffsets,
  cueIdFor,
  describeAnchor,
  overlayIdFor,
  parseTimelineEdits,
  recordingEndMsOf,
  resolveTimelineAnchor,
  resolveTimelineEditsForVideo,
  splitEdits,
} from './timelineEdits.js'

const anchor = (
  ref: Anchor['ref'],
  offsetMs = 0,
  edge: 'start' | 'end' = 'start'
): Anchor => ({ ref, edge, offsetMs })

const actionEvent = (key: string, timeMs: number, durationMs = 0) => {
  const [kind, subKind, name, ordinal] = key.split('|')
  return {
    type: 'delay',
    timeMs,
    durationMs,
    editable: {
      descriptor: {
        kind,
        ...(subKind ? { subKind } : {}),
        ...(name ? { name } : {}),
        ordinal: Number(ordinal),
        seq: 0,
      },
      locked: false,
      schemaKind: 'delay',
      defaults: {},
    },
  }
}

const baseEvents = [
  { type: 'videoStart', timeMs: 0 },
  actionEvent('delay||intro|0', 1000, 500),
  { type: 'timestamp', timeMs: 2000, name: 'mark' },
  { type: 'timestamp', timeMs: 2500, name: 'mark' },
  { type: 'cueStart', timeMs: 3000, name: 'welcome' },
  { type: 'assetStart', timeMs: 4000, name: 'logo', kind: 'image' },
  { type: 'assetEnd', timeMs: 5000, name: 'logo' },
  { type: 'videoEnd', timeMs: 6000 },
]

function makeReport(): {
  report: OverrideReportBuilder
  lines: string[]
} {
  const lines: string[] = []
  return {
    report: new OverrideReportBuilder((line) => lines.push(line)),
    lines,
  }
}

function itemsOf(report: OverrideReportBuilder): OverrideReportItem[] {
  return report.items()
}

describe('parseTimelineEdits', () => {
  const env = (value: string): NodeJS.ProcessEnv => ({
    [SCREENCI_TIMELINE_EDITS_ENV]: value,
  })

  it('returns null when unset or malformed', () => {
    expect(parseTimelineEdits({})).toBeNull()
    expect(parseTimelineEdits(env('not json'))).toBeNull()
    expect(parseTimelineEdits(env('42'))).toBeNull()
  })

  it('parses valid paramEdits and placedEvents', () => {
    const doc = {
      demo: {
        version: 2,
        edits: [
          {
            type: 'paramEdit',
            id: 'p1',
            target: { key: 'delay||intro|0' },
            fields: { durationMs: 800 },
          },
          {
            type: 'placedEvent',
            id: 'e1',
            kind: 'hide',
            anchor: {
              ref: { type: 'videoStart' },
              edge: 'start',
              offsetMs: 100,
            },
            end: { durationMs: 500 },
          },
        ],
      },
    }
    const parsed = parseTimelineEdits(env(JSON.stringify(doc)))
    expect(parsed?.demo.edits).toHaveLength(2)
    expect(parsed?.demo.invalid).toHaveLength(0)
  })

  it('keeps invalid records as reported problems instead of dropping them', () => {
    const doc = {
      demo: {
        version: 2,
        edits: [
          { type: 'placedEvent', id: 'bad1', kind: 'hide' },
          { type: 'paramEdit', id: 'bad2' },
          { type: 'mystery', id: 'bad3' },
          {
            type: 'placedEvent',
            id: 'ok',
            kind: 'timestamp',
            anchor: { ref: { type: 'videoStart' }, edge: 'start', offsetMs: 0 },
            props: { name: 'web-mark' },
          },
        ],
      },
    }
    const parsed = parseTimelineEdits(env(JSON.stringify(doc)))
    expect(parsed?.demo.edits.map((edit) => edit.id)).toEqual(['ok'])
    expect(parsed?.demo.invalid.map((entry) => entry.id)).toEqual([
      'bad1',
      'bad2',
      'bad3',
    ])
    expect(parsed?.demo.invalid[0]?.reason).toContain('anchor')
  })

  it('resolves per-video edits', () => {
    const doc: Record<string, unknown> = {
      other: { version: 2, edits: [] },
    }
    expect(
      resolveTimelineEditsForVideo('missing', env(JSON.stringify(doc)))
    ).toBeNull()
  })
})

describe('splitEdits', () => {
  it('splits by type and drops disabled placed events', () => {
    const split = splitEdits([
      {
        type: 'paramEdit',
        id: 'p1',
        target: { key: 'k' },
        fields: {},
      },
      {
        type: 'placedEvent',
        id: 'e1',
        kind: 'hide',
        anchor: anchor({ type: 'videoStart' }),
        end: { durationMs: 100 },
      },
      {
        type: 'placedEvent',
        id: 'e2',
        kind: 'hide',
        anchor: anchor({ type: 'videoStart' }),
        end: { durationMs: 100 },
        disabled: true,
      },
    ])
    expect(split.paramEdits.map((edit) => edit.id)).toEqual(['p1'])
    expect(split.placedEvents.map((edit) => edit.id)).toEqual(['e1'])
  })
})

describe('resolveTimelineAnchor', () => {
  it('resolves videoStart and videoEnd with offsets', () => {
    expect(
      resolveTimelineAnchor(baseEvents, anchor({ type: 'videoStart' }, 250))
    ).toBe(250)
    expect(
      resolveTimelineAnchor(baseEvents, anchor({ type: 'videoEnd' }, -500))
    ).toBe(recordingEndMsOf(baseEvents) - 500)
  })

  it('resolves action anchors by stable key and edge', () => {
    expect(
      resolveTimelineAnchor(
        baseEvents,
        anchor({ type: 'action', key: 'delay||intro|0' }, 10)
      )
    ).toBe(1010)
    expect(
      resolveTimelineAnchor(
        baseEvents,
        anchor({ type: 'action', key: 'delay||intro|0' }, 10, 'end')
      )
    ).toBe(1510)
  })

  it('resolves timestamp anchors by name and ordinal', () => {
    expect(
      resolveTimelineAnchor(
        baseEvents,
        anchor({ type: 'timestamp', name: 'mark', ordinal: 1 }, 5)
      )
    ).toBe(2505)
  })

  it('resolves cue anchors by stable cue id', () => {
    expect(
      resolveTimelineAnchor(
        baseEvents,
        anchor({ type: 'cue', cueId: cueIdFor('welcome', 0) }, -100)
      )
    ).toBe(2900)
  })

  it('returns null for missing anchors', () => {
    expect(
      resolveTimelineAnchor(
        baseEvents,
        anchor({ type: 'action', key: 'delay||gone|0' })
      )
    ).toBeNull()
    expect(
      resolveTimelineAnchor(
        baseEvents,
        anchor({ type: 'timestamp', name: 'mark', ordinal: 2 })
      )
    ).toBeNull()
  })
})

describe('applyPlacedEvents', () => {
  const placed = (overrides: Partial<PlacedEvent>): PlacedEvent => ({
    type: 'placedEvent',
    id: 'e1',
    kind: 'hide',
    anchor: anchor({ type: 'videoStart' }, 1000),
    end: { durationMs: 500 },
    ...overrides,
  })

  it('inserts hide/speed/time span pairs at resolved positions', () => {
    const { report } = makeReport()
    const result = applyPlacedEvents(
      baseEvents,
      [
        placed({ id: 'h1', kind: 'hide' }),
        placed({
          id: 's1',
          kind: 'speed',
          anchor: anchor({ type: 'action', key: 'delay||intro|0' }, 0, 'end'),
          end: { durationMs: 400 },
          props: { multiplier: 3 },
        }),
        placed({
          id: 't1',
          kind: 'time',
          anchor: anchor({ type: 'timestamp', name: 'mark', ordinal: 0 }),
          end: { durationMs: 300 },
          props: { durationMs: 100 },
        }),
      ],
      report
    ) as Array<Record<string, unknown>>

    const types = result.map((event) => event.type)
    expect(types).toContain('hideStart')
    expect(types).toContain('hideEnd')
    const speedStart = result.find((event) => event.type === 'speedStart')
    expect(speedStart?.timeMs).toBe(1500)
    expect(speedStart?.multiplier).toBe(3)
    const timeStart = result.find((event) => event.type === 'timeStart')
    expect(timeStart?.timeMs).toBe(2000)
    expect(timeStart?.durationMs).toBe(100)
    expect(itemsOf(report).map((item) => item.status)).toEqual([
      'applied',
      'applied',
      'applied',
    ])
  })

  it('supports end anchors for spans', () => {
    const { report } = makeReport()
    const result = applyPlacedEvents(
      baseEvents,
      [
        placed({
          id: 'h1',
          kind: 'hide',
          anchor: anchor({ type: 'timestamp', name: 'mark', ordinal: 0 }),
          end: {
            anchor: anchor({ type: 'timestamp', name: 'mark', ordinal: 1 }),
          },
        }),
      ],
      report
    ) as Array<Record<string, unknown>>
    const start = result.find((event) => event.type === 'hideStart')
    const end = result.find((event) => event.type === 'hideEnd')
    expect(start?.timeMs).toBe(2000)
    expect(end?.timeMs).toBe(2500)
  })

  it('falls back to capturedAtMs when the anchor is missing', () => {
    const { report } = makeReport()
    const result = applyPlacedEvents(
      baseEvents,
      [
        placed({
          id: 'h1',
          anchor: anchor({ type: 'action', key: 'delay||gone|0' }),
          capturedAtMs: 1200,
          end: { durationMs: 400 },
        }),
      ],
      report
    ) as Array<Record<string, unknown>>
    const start = result.find((event) => event.type === 'hideStart')
    expect(start?.timeMs).toBe(1200)
    const [item] = itemsOf(report)
    expect(item?.status).toBe('fallback')
    expect(item?.reason).toContain('anchorMissing:action:delay||gone|0')
  })

  it('skips with a reported reason when nothing resolves', () => {
    const { report, lines } = makeReport()
    const result = applyPlacedEvents(
      baseEvents,
      [placed({ anchor: anchor({ type: 'action', key: 'delay||gone|0' }) })],
      report
    )
    expect(result).toHaveLength(baseEvents.length)
    const [item] = itemsOf(report)
    expect(item?.status).toBe('skipped')
    expect(item?.reason).toBe('anchorMissing:action:delay||gone|0')
    expect(lines.some((line) => line.includes('SKIPPED'))).toBe(true)
  })

  it('skips empty or inverted ranges', () => {
    const { report } = makeReport()
    applyPlacedEvents(
      baseEvents,
      [
        placed({
          anchor: anchor({ type: 'timestamp', name: 'mark', ordinal: 1 }),
          end: {
            anchor: anchor({ type: 'timestamp', name: 'mark', ordinal: 0 }),
          },
        }),
      ],
      report
    )
    expect(itemsOf(report)[0]?.reason).toContain('emptyRange')
  })

  it('inserts web-created timestamps and studio narration cues', () => {
    const { report } = makeReport()
    const result = applyPlacedEvents(
      baseEvents,
      [
        placed({
          id: 'ts1',
          kind: 'timestamp',
          anchor: anchor({ type: 'videoStart' }, 1500),
          end: undefined,
          props: { name: 'web-mark' },
        }),
        placed({
          id: 'n1',
          kind: 'narrationCue',
          anchor: anchor({ type: 'timestamp', name: 'mark', ordinal: 0 }, 50),
          end: undefined,
          props: { name: 'new-cue' },
        }),
      ],
      report
    ) as Array<Record<string, unknown>>
    const stamp = result.find(
      (event) => event.type === 'timestamp' && event.name === 'web-mark'
    )
    expect(stamp?.timeMs).toBe(1500)
    const cue = result.find(
      (event) => event.type === 'cueStart' && event.name === 'new-cue'
    )
    expect(cue?.timeMs).toBe(2050)
    expect(cue?.studio).toBe(true)
  })

  it('moves an existing cue by stable id', () => {
    const { report } = makeReport()
    const result = applyPlacedEvents(
      baseEvents,
      [
        placed({
          id: 'n1',
          kind: 'narrationCue',
          anchor: anchor({ type: 'videoStart' }, 500),
          end: undefined,
          targetId: cueIdFor('welcome', 0),
        }),
      ],
      report
    ) as Array<Record<string, unknown>>
    const cue = result.find((event) => event.type === 'cueStart')
    expect(cue?.timeMs).toBe(500)
    expect(cue?.name).toBe('welcome')
    expect(result.filter((event) => event.type === 'cueStart')).toHaveLength(1)
  })

  it('moves an overlay and its end together, or retimes with durationMs', () => {
    const { report } = makeReport()
    const moved = applyPlacedEvents(
      baseEvents,
      [
        placed({
          id: 'o1',
          kind: 'overlay',
          anchor: anchor({ type: 'videoStart' }, 4500),
          end: undefined,
          targetId: overlayIdFor('logo', 0),
        }),
      ],
      report
    ) as Array<Record<string, unknown>>
    expect(moved.find((event) => event.type === 'assetStart')?.timeMs).toBe(
      4500
    )
    expect(moved.find((event) => event.type === 'assetEnd')?.timeMs).toBe(5500)

    const retimed = applyPlacedEvents(
      baseEvents,
      [
        placed({
          id: 'o2',
          kind: 'overlay',
          anchor: anchor({ type: 'videoStart' }, 4200),
          end: { durationMs: 600 },
          targetId: overlayIdFor('logo', 0),
        }),
      ],
      makeReport().report
    ) as Array<Record<string, unknown>>
    expect(retimed.find((event) => event.type === 'assetEnd')?.timeMs).toBe(
      4800
    )
  })

  it('inserts zoom windows and widens boundaries out of input spans', () => {
    const input = {
      type: 'input',
      subType: 'click',
      events: [{ startMs: 1000, endMs: 1600 }],
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
    const events = [
      { type: 'videoStart', timeMs: 0 },
      input,
      { type: 'videoEnd', timeMs: 5000 },
    ]
    const { report } = makeReport()
    const result = applyPlacedEvents(
      events,
      [
        placed({
          id: 'z1',
          kind: 'zoom',
          // Lead-in starting 400ms before the click, but the end boundary
          // lands inside the click span (1000..1600) and must widen to its
          // end.
          anchor: anchor(
            { type: 'action', key: 'input|click|getByRole(button)|0' },
            -400,
            'start'
          ),
          end: { durationMs: 700 },
          props: { amount: 0.6, duration: 500 },
        }),
      ],
      report
    ) as Array<Record<string, unknown>>
    const start = result.find((event) => event.type === 'autoZoomStart')
    const end = result.find((event) => event.type === 'autoZoomEnd')
    expect(start?.timeMs).toBe(600)
    expect(start?.amount).toBe(0.6)
    expect(start?.duration).toBe(500)
    // 600 + 700 = 1300 falls inside the input span, widened to 1600.
    expect(end?.timeMs).toBe(1600)
    expect(itemsOf(report)[0]?.status).toBe('applied')
    expect(itemsOf(report)[0]?.resolvedEndMs).toBe(1600)
  })

  it('reports targetMissing when a moved cue no longer exists', () => {
    const { report } = makeReport()
    applyPlacedEvents(
      baseEvents,
      [
        placed({
          id: 'n1',
          kind: 'narrationCue',
          anchor: anchor({ type: 'videoStart' }, 500),
          end: undefined,
          targetId: cueIdFor('gone', 0),
        }),
      ],
      report
    )
    expect(itemsOf(report)[0]?.status).toBe('skipped')
    expect(itemsOf(report)[0]?.reason).toBe(
      `targetMissing:${cueIdFor('gone', 0)}`
    )
  })
})

describe('applyZoomWindowOffsets', () => {
  const zoomEvents = (extra: Record<string, unknown>) => [
    { type: 'videoStart', timeMs: 0 },
    {
      type: 'input',
      subType: 'click',
      events: [{ startMs: 100, endMs: 400 }],
    },
    {
      type: 'autoZoomStart',
      timeMs: 1000,
      easing: 'ease-out',
      duration: 750,
      amount: 0.72,
      ...extra,
    },
    { type: 'cueStart', timeMs: 1500, name: 'talk' },
    { type: 'autoZoomEnd', timeMs: 2000, easing: 'ease-out', duration: 750 },
    { type: 'videoEnd', timeMs: 5000 },
  ]

  it('shifts both boundaries and strips the offset fields', () => {
    const result = applyZoomWindowOffsets(
      zoomEvents({ startOffset: -400, endOffset: 600 })
    ) as Array<Record<string, unknown>>
    const start = result.find((event) => event.type === 'autoZoomStart')
    const end = result.find((event) => event.type === 'autoZoomEnd')
    expect(start?.timeMs).toBe(600)
    expect(end?.timeMs).toBe(2600)
    expect(start?.startOffset).toBeUndefined()
    expect(start?.endOffset).toBeUndefined()
    // The shifted start re-sorted before the cue but after the input.
    expect(result.findIndex((event) => event.type === 'autoZoomStart')).toBe(2)
  })

  it('widens boundaries out of interaction spans and clamps to the recording', () => {
    const result = applyZoomWindowOffsets(
      zoomEvents({ startOffset: -650, endOffset: 4000 })
    ) as Array<Record<string, unknown>>
    // 1000 - 650 = 350 falls inside the click span (100..400): widened to 100.
    expect(result.find((event) => event.type === 'autoZoomStart')?.timeMs).toBe(
      100
    )
    // 2000 + 4000 clamps to the recording end.
    expect(result.find((event) => event.type === 'autoZoomEnd')?.timeMs).toBe(
      5000
    )
  })

  it('leaves plain zoom windows untouched', () => {
    const input = zoomEvents({})
    expect(applyZoomWindowOffsets(input)).toEqual(input)
  })
})

describe('OverrideReportBuilder', () => {
  it('always logs non-applied outcomes and a summary', () => {
    const lines: string[] = []
    const report = new OverrideReportBuilder((line) => lines.push(line))
    report.add({
      editId: 'e1',
      channel: 'placedEvent',
      status: 'applied',
      resolvedStartMs: 100,
    })
    report.add({
      editId: 'e2',
      channel: 'placedEvent',
      status: 'skipped',
      reason: 'anchorMissing:videoEnd',
    })
    report.logSummary('demo')
    expect(lines.some((line) => line.includes('SKIPPED'))).toBe(true)
    expect(lines.some((line) => line.includes('1 applied, 1 skipped'))).toBe(
      true
    )
    expect(report.items()).toHaveLength(2)
  })
})

describe('describeAnchor', () => {
  it('formats refs, edges and offsets', () => {
    expect(
      describeAnchor(
        anchor({ type: 'action', key: 'delay||intro|0' }, 250, 'end')
      )
    ).toBe('action:delay||intro|0.end+250ms')
    expect(describeAnchor(anchor({ type: 'videoStart' }, -50))).toBe(
      'videoStart.start-50ms'
    )
  })
})
