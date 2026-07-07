import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  collectEditableFromRecordings,
  diffEditableOverridesAgainstSnapshot,
  formatAuthoredStatusReport,
  formatEditableStatusReport,
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

describe('formatAuthoredStatusReport', () => {
  it('reports resolved, missing and unverified anchors', () => {
    const lines = formatAuthoredStatusReport(SNAPSHOT, {
      'My video': [
        {
          id: 'a1',
          kind: 'hide',
          from: { ref: 'input|click|getByRole(button)|0', offsetMs: 200 },
          to: { durationMs: 500 },
        },
        {
          id: 'a2',
          kind: 'speed',
          from: { ref: 'input|click|gone|3', offsetMs: 0 },
          to: { anchor: { ref: 'timestamp||checkout|0' } },
        },
      ],
    })
    const report = lines.join('\n')
    expect(report).toContain("hide 'a1'")
    expect(report).toContain('anchor ok')
    expect(report).toContain('anchor MISSING')
    expect(report).toContain('unverified')
  })

  it('returns no lines without authored events', () => {
    expect(formatAuthoredStatusReport(SNAPSHOT, {})).toEqual([])
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
