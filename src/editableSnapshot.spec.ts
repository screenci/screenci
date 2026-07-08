import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  collectEditableFromRecordings,
  diffEditableOverridesAgainstSnapshot,
  buildEditablePlacementPrompt,
  formatEditableStatusReport,
  formatPlacedStatusReport,
  splitTimelineEditsByVideo,
  mergeEditableSnapshot,
  readEditableSnapshot,
  updateEditableSnapshot,
  writeEditableSnapshot,
  type EditableSnapshot,
} from './editableSnapshot.js'

const SNAPSHOT: EditableSnapshot = {
  version: 1,
  videos: {
    'My video': [
      {
        key: 'input|click|getByRole(button)|0',
        locked: true,
        lockedFields: ['moveDuration'],
        defaults: { moveDuration: 400, moveEasing: 'ease-in-out' },
      },
      {
        key: 'autoZoom|||0',
        locked: false,
        defaults: { amount: 0.72 },
      },
    ],
  },
}

describe('diffEditableOverridesAgainstSnapshot', () => {
  it('reports only overrides shadowing explicitly code-set fields', () => {
    const collisions = diffEditableOverridesAgainstSnapshot(SNAPSHOT, {
      'My video': [
        {
          key: 'input|click|getByRole(button)|0',
          values: { moveDuration: 250, moveEasing: 'linear' },
        },
        { key: 'autoZoom|||0', values: { amount: 0.5 } },
      ],
    })
    expect(collisions).toEqual([
      {
        videoName: 'My video',
        key: 'input|click|getByRole(button)|0',
        field: 'moveDuration',
        codeValue: 400,
        editorValue: 250,
      },
    ])
  })

  it('treats a locked entry without lockedFields as all-explicit', () => {
    const snapshot: EditableSnapshot = {
      version: 1,
      videos: {
        v: [{ key: 'delay|||0', locked: true, defaults: { durationMs: 500 } }],
      },
    }
    const collisions = diffEditableOverridesAgainstSnapshot(snapshot, {
      v: [{ key: 'delay|||0', values: { durationMs: 100 } }],
    })
    expect(collisions).toHaveLength(1)
  })

  it('ignores unknown videos, unknown keys and equal values', () => {
    expect(
      diffEditableOverridesAgainstSnapshot(SNAPSHOT, {
        Other: [{ key: 'x', values: { a: 1 } }],
        'My video': [
          { key: 'missing', values: { a: 1 } },
          {
            key: 'input|click|getByRole(button)|0',
            values: { moveDuration: 400 },
          },
        ],
      })
    ).toEqual([])
  })
})

describe('formatEditableStatusReport', () => {
  it('classifies shadowing, default-changing, in-sync and stale overrides', () => {
    const lines = formatEditableStatusReport(SNAPSHOT, {
      'My video': [
        {
          key: 'input|click|getByRole(button)|0',
          values: { moveDuration: 250, moveEasing: 'linear' },
        },
        { key: 'autoZoom|||0', values: { amount: 0.72 } },
        { key: 'gone|||0', values: { x: 1 } },
      ],
    })
    const report = lines.join('\n')
    expect(report).toContain('Video: My video')
    expect(report).toContain(
      'moveDuration: override shadows explicit code value'
    )
    expect(report).toContain('code 400 -> editor 250')
    expect(report).toContain('moveEasing: changes default')
    expect(report).toContain('amount: in sync')
    expect(report).toContain('gone|||0: stale')
  })

  it('returns no lines without overrides', () => {
    expect(formatEditableStatusReport(SNAPSHOT, {})).toEqual([])
    expect(formatEditableStatusReport(SNAPSHOT, { v: [] })).toEqual([])
  })
})

describe('formatPlacedStatusReport', () => {
  it('reports resolved, missing and unverified anchors', () => {
    const lines = formatPlacedStatusReport(SNAPSHOT, {
      'My video': [
        {
          type: 'placedEvent',
          id: 'a1',
          kind: 'hide',
          anchor: {
            ref: { type: 'action', key: 'input|click|getByRole(button)|0' },
            edge: 'end',
            offsetMs: 200,
          },
          end: { durationMs: 500 },
        },
        {
          type: 'placedEvent',
          id: 'a2',
          kind: 'speed',
          anchor: {
            ref: { type: 'action', key: 'input|click|gone|3' },
            edge: 'start',
            offsetMs: 0,
          },
          end: {
            anchor: {
              ref: { type: 'timestamp', name: 'checkout', ordinal: 0 },
              edge: 'start',
              offsetMs: 0,
            },
          },
        },
      ],
    })
    const report = lines.join('\n')
    expect(report).toContain("hide 'a1'")
    expect(report).toContain('anchor ok')
    expect(report).toContain('anchor MISSING')
    expect(report).toContain('unverified')
  })

  it('returns no lines without placed events', () => {
    expect(formatPlacedStatusReport(SNAPSHOT, {})).toEqual([])
  })
})

describe('splitTimelineEditsByVideo', () => {
  it('splits docs into param-edit entries and placed events', () => {
    const { overrides, placed } = splitTimelineEditsByVideo({
      demo: {
        version: 2,
        edits: [
          {
            type: 'paramEdit',
            id: 'p1',
            target: { key: 'delay|||0' },
            fields: { durationMs: 100 },
          },
          {
            type: 'placedEvent',
            id: 'e1',
            kind: 'hide',
            anchor: { ref: { type: 'videoStart' }, edge: 'start', offsetMs: 0 },
            end: { durationMs: 100 },
          },
          {
            type: 'placedEvent',
            id: 'e2',
            kind: 'hide',
            anchor: { ref: { type: 'videoStart' }, edge: 'start', offsetMs: 0 },
            end: { durationMs: 100 },
            disabled: true,
          },
        ],
      },
      broken: 'not a doc',
    })
    expect(overrides).toEqual({
      demo: [{ key: 'delay|||0', values: { durationMs: 100 } }],
    })
    expect(placed.demo?.map((event) => event.id)).toEqual(['e1'])
    expect(placed.broken).toBeUndefined()
  })
})

describe('buildEditablePlacementPrompt', () => {
  const SOURCED: EditableSnapshot = {
    version: 1,
    videos: {
      'My video': [
        {
          key: 'input|click|getByRole(button)|0',
          locked: true,
          lockedFields: ['moveDuration'],
          defaults: { moveDuration: 400, sleepBefore: 0 },
          source: { file: 'recordings/pitch.screenci.ts', line: 42 },
        },
        {
          key: 'timestamp||mark|0',
          locked: true,
          defaults: {},
          source: { file: 'recordings/pitch.screenci.ts', line: 50 },
        },
      ],
    },
  }

  it('emits CHANGE / INSERT / WRAP instructions with call sites', () => {
    const lines = buildEditablePlacementPrompt(
      SOURCED,
      {
        'My video': [
          {
            key: 'input|click|getByRole(button)|0',
            values: { moveDuration: 150, sleepBefore: 1300 },
          },
        ],
      },
      {
        'My video': [
          {
            type: 'placedEvent',
            id: 'a1',
            kind: 'speed',
            anchor: {
              ref: { type: 'timestamp', name: 'mark', ordinal: 0 },
              edge: 'start',
              offsetMs: 50,
            },
            end: { durationMs: 200 },
            props: { multiplier: 3 },
          },
          {
            type: 'placedEvent',
            id: 'z1',
            kind: 'zoom',
            anchor: {
              ref: { type: 'action', key: 'input|click|getByRole(button)|0' },
              edge: 'start',
              offsetMs: -400,
            },
            end: {
              anchor: {
                ref: {
                  type: 'action',
                  key: 'input|click|getByRole(button)|0',
                },
                edge: 'end',
                offsetMs: 600,
              },
            },
            props: { amount: 0.6 },
          },
          {
            type: 'placedEvent',
            id: 'n1',
            kind: 'narrationCue',
            anchor: {
              ref: { type: 'action', key: 'input|click|getByRole(button)|0' },
              edge: 'end',
              offsetMs: 800,
            },
            targetId: 'cue||intro|0',
            props: { name: 'intro' },
          },
        ],
      }
    )
    const text = lines.join('\n')
    expect(text).toContain('## Video: My video')
    expect(text).toContain(
      'CHANGE recordings/pitch.screenci.ts:42: set `moveDuration` to 150'
    )
    expect(text).toContain(
      'INSERT `await page.waitForTimeout(1300)` immediately BEFORE recordings/pitch.screenci.ts:42'
    )
    expect(text).toContain(
      "ADD `placeSpeed({ from: 'mark', offsetMs: 50, durationMs: 200, multiplier: 3 })`"
    )
    expect(text).toContain(
      "ADD `placeZoom({ from: { action: 'input|click|getByRole(button)|0', " +
        "edge: 'start' }, offsetMs: -400, until: { action: " +
        "'input|click|getByRole(button)|0' }, untilOffsetMs: 600, " +
        'amount: 0.6 })`'
    )
    expect(text).toContain("web event 'a1'")
    expect(text).toContain('MOVE the `await narration.intro...` call')
    expect(text).toContain("`await waitSince('<marker>', 800)`")
    expect(text).toContain('recordings/pitch.screenci.ts:42')
    expect(text).toContain('ripples')
  })

  it('returns nothing when there is nothing to codify', () => {
    expect(buildEditablePlacementPrompt(SOURCED, {}, {})).toEqual([])
    // An override equal to the code value needs no change.
    expect(
      buildEditablePlacementPrompt(SOURCED, {
        'My video': [
          {
            key: 'input|click|getByRole(button)|0',
            values: { moveDuration: 400 },
          },
        ],
      })
    ).toEqual([])
  })
})

describe('snapshot file round-trip', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'screenci-editable-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads back what it wrote and tolerates a missing file', () => {
    expect(readEditableSnapshot(dir)).toEqual({ version: 1, videos: {} })
    writeEditableSnapshot(dir, SNAPSHOT)
    expect(readEditableSnapshot(dir)).toEqual(SNAPSHOT)
  })

  it('collects editable metas from recording data.json files', () => {
    const recDir = join(dir, 'My video [en]')
    mkdirSync(recDir)
    writeFileSync(
      join(recDir, 'data.json'),
      JSON.stringify({
        metadata: { videoName: 'My video' },
        events: [
          {
            type: 'input',
            editable: {
              descriptor: {
                kind: 'input',
                subKind: 'click',
                matcher: 'getByRole(button)',
                ordinal: 0,
                seq: 0,
              },
              locked: true,
              lockedFields: ['moveDuration'],
              schemaKind: 'cursorMove',
              defaults: { moveDuration: 400 },
            },
          },
          { type: 'cueStart' },
        ],
      })
    )
    const collected = collectEditableFromRecordings(dir)
    expect(collected['My video']).toEqual([
      {
        key: 'input|click|getByRole(button)|0',
        locked: true,
        lockedFields: ['moveDuration'],
        defaults: { moveDuration: 400 },
      },
    ])
  })

  it('updateEditableSnapshot merges recorded videos over existing ones', () => {
    writeEditableSnapshot(dir, SNAPSHOT)
    const recDir = join(dir, 'Other video [en]')
    mkdirSync(recDir)
    writeFileSync(
      join(recDir, 'data.json'),
      JSON.stringify({
        metadata: { videoName: 'Other video' },
        events: [
          {
            type: 'delay',
            editable: {
              descriptor: { kind: 'delay', ordinal: 0, seq: 0 },
              locked: false,
              schemaKind: 'delay',
              defaults: { durationMs: 0 },
            },
          },
        ],
      })
    )
    updateEditableSnapshot(dir)
    const merged = readEditableSnapshot(dir)
    expect(Object.keys(merged.videos).sort()).toEqual([
      'My video',
      'Other video',
    ])
    expect(merged.videos['Other video']).toEqual([
      { key: 'delay|||0', locked: false, defaults: { durationMs: 0 } },
    ])
  })

  it('mergeEditableSnapshot keeps videos not recorded this run', () => {
    const merged = mergeEditableSnapshot(SNAPSHOT, { New: [] })
    expect(Object.keys(merged.videos).sort()).toEqual(['My video', 'New'])
  })
})
