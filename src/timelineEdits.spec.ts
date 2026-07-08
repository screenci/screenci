import { describe, expect, it } from 'vitest'

import {
  OverrideReportBuilder,
  SCREENCI_TIMELINE_EDITS_ENV,
  cueIdFor,
  overlayIdFor,
  parseTimelineEdits,
  resolveTimelineEditsForVideo,
  splitEdits,
  type EditRecord,
} from './timelineEdits.js'

const env = (value: string): NodeJS.ProcessEnv => ({
  [SCREENCI_TIMELINE_EDITS_ENV]: value,
})

describe('parseTimelineEdits', () => {
  it('returns null when unset or malformed', () => {
    expect(parseTimelineEdits({})).toBeNull()
    expect(parseTimelineEdits(env('not json'))).toBeNull()
    expect(parseTimelineEdits(env('42'))).toBeNull()
  })

  it('parses every valid record kind', () => {
    const doc = {
      demo: {
        version: 3,
        edits: [
          {
            type: 'paramEdit',
            id: 'p1',
            target: { key: 'delay||intro|0' },
            fields: { durationMs: 800 },
          },
          {
            type: 'renameEdit',
            id: 'r1',
            target: { editId: 'click1' },
            newEditId: 'save',
          },
          {
            type: 'mediaEdit',
            id: 'm1',
            kind: 'narrationCue',
            afterEditId: 'click1',
            blocking: true,
            sleepBeforeMs: 200,
            props: { name: 'intro' },
          },
          {
            type: 'zoomEdit',
            id: 'z1',
            fromEditId: 'click1',
            untilEditId: 'fill1',
            leadInMs: 400,
            holdMs: 600,
          },
          {
            type: 'gapSpanEdit',
            id: 'g1',
            kind: 'hide',
            fromEditId: 'click1',
            untilEditId: 'fill1',
          },
          {
            type: 'gapPointEdit',
            id: 'gp1',
            kind: 'background',
            afterEditId: 'click1',
            props: { backgroundCss: '#101014' },
          },
        ],
      },
    }
    const parsed = parseTimelineEdits(env(JSON.stringify(doc)))
    expect(parsed?.demo.edits).toHaveLength(6)
    expect(parsed?.demo.invalid).toHaveLength(0)
  })

  it('keeps invalid records as reported problems instead of dropping them', () => {
    const doc = {
      demo: {
        version: 3,
        edits: [
          { type: 'mediaEdit', id: 'bad1', kind: 'narrationCue' }, // no afterEditId/blocking
          { type: 'paramEdit', id: 'bad2' },
          { type: 'zoomEdit', id: 'bad3', fromEditId: 'a' }, // no untilEditId
          {
            type: 'gapSpanEdit',
            id: 'bad4',
            kind: 'nope',
            fromEditId: 'a',
            untilEditId: 'b',
          },
          { type: 'mystery', id: 'bad5' },
          {
            type: 'gapPointEdit',
            id: 'ok',
            kind: 'recording',
            afterEditId: 'click1',
            props: { visible: false },
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
      'bad4',
      'bad5',
    ])
  })

  it('resolves per-video edits', () => {
    const doc: Record<string, unknown> = {
      other: { version: 3, edits: [] },
    }
    expect(
      resolveTimelineEditsForVideo('missing', env(JSON.stringify(doc)))
    ).toBeNull()
  })
})

describe('splitEdits', () => {
  it('splits param edits from codify records and drops disabled/rename', () => {
    const edits: EditRecord[] = [
      { type: 'paramEdit', id: 'p1', target: { key: 'k' }, fields: {} },
      {
        type: 'renameEdit',
        id: 'r1',
        target: { editId: 'a' },
        newEditId: 'b',
      },
      {
        type: 'mediaEdit',
        id: 'm1',
        kind: 'overlay',
        afterEditId: 'click1',
        blocking: false,
        props: { name: 'logo' },
      },
      {
        type: 'zoomEdit',
        id: 'z1',
        fromEditId: 'a',
        untilEditId: 'b',
        disabled: true,
      },
    ]
    const split = splitEdits(edits)
    expect(split.paramEdits.map((edit) => edit.id)).toEqual(['p1'])
    expect(split.codifyEdits.map((edit) => edit.id)).toEqual(['m1'])
  })
})

describe('cueIdFor / overlayIdFor', () => {
  it('produces stable name-ordinal ids', () => {
    expect(cueIdFor('welcome', 0)).toBe('cue||welcome|0')
    expect(overlayIdFor('logo', 2)).toBe('overlay||logo|2')
  })
})

describe('OverrideReportBuilder', () => {
  it('always logs non-applied outcomes and a summary', () => {
    const lines: string[] = []
    const report = new OverrideReportBuilder((line) => lines.push(line))
    report.add({
      editId: 'e1',
      channel: 'paramEdit',
      status: 'applied',
      resolvedStartMs: 100,
    })
    report.add({
      editId: 'e2',
      channel: 'codifyEdit',
      status: 'skipped',
      reason: 'invalidRecord:missing id',
    })
    report.logSummary('demo')
    expect(lines.some((line) => line.includes('SKIPPED'))).toBe(true)
    expect(lines.some((line) => line.includes('1 applied, 1 skipped'))).toBe(
      true
    )
    expect(report.items()).toHaveLength(2)
  })
})
