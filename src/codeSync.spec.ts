import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { compareWebStateToSnapshot } from './actionSync.js'
import type { ActionParamsSnapshot } from './actionParamsSnapshot.js'
import type { EditableSnapshot } from './editableSnapshot.js'
import type { PlacedEvent } from './timelineEdits.js'
import { planCodeSync, type CodeSyncInput } from './codeSync.js'

const FILE = '/proj/demo.screenci.ts'
const SAVE_SELECTOR = "getByRole('button', { name: 'Save' })"

// The fixture is editId-stamped: stable keys ARE the slugs.
const SOURCE = [
  "import { video, autoZoom } from 'screenci'", // 1
  '', // 2
  "video('Demo', async ({ page }) => {", // 3
  '  await autoZoom(', // 4
  '    async () => {', // 5
  "      await page.getByRole('button', { name: 'Save' }).click({ move: { duration: 500 }, editId: 'click1' })", // 6
  '    },', // 7
  "    { editId: 'autoZoom1' }", // 8
  '  )', // 9
  "  await page.locator('#name').fill('Jane', { editId: 'fill1' })", // 10
  '})', // 11
  '',
].join('\n')

const ACTION_SNAPSHOT: ActionParamsSnapshot = {
  version: 1,
  videos: {
    Demo: [
      {
        selector: SAVE_SELECTOR,
        method: 'click',
        occurrence: 0,
        editId: 'click1',
        params: { 'move.duration': { value: 500, source: 'explicit' } },
      },
      {
        selector: "locator('#name')",
        method: 'fill',
        occurrence: 0,
        editId: 'fill1',
        params: { duration: { value: 600, source: 'default' } },
      },
    ],
  },
}

const EDITABLE_SNAPSHOT: EditableSnapshot = {
  version: 1,
  videos: {
    Demo: [
      {
        key: 'click1',
        editId: 'click1',
        locked: false,
        defaults: { sleepBefore: 0 },
        source: { file: FILE, line: 6 },
      },
      {
        key: 'autoZoom1',
        editId: 'autoZoom1',
        locked: false,
        defaults: { startOffset: 0, endOffset: 0 },
        source: { file: FILE, line: 4 },
      },
    ],
  },
}

function inputWith(overrides: Partial<CodeSyncInput>): CodeSyncInput {
  return {
    comparison: { videos: [], snapshotEmpty: false },
    actionSnapshot: ACTION_SNAPSHOT,
    editableSnapshot: EDITABLE_SNAPSHOT,
    editableOverrides: {},
    placedEvents: {},
    renames: {},
    ...overrides,
  }
}

function plan(
  input: CodeSyncInput,
  files: Record<string, string> = { [FILE]: SOURCE }
) {
  return planCodeSync(input, {
    ts,
    readFile: (path) => files[path] ?? null,
  })
}

describe('planCodeSync: action-parameter overrides', () => {
  it('applies change and codify by slug, routes stale to fallback', () => {
    const comparison = compareWebStateToSnapshot(ACTION_SNAPSHOT, {
      Demo: {
        [`${SAVE_SELECTOR}|click|0|move.duration`]: 1200,
        [`locator('#name')|fill|0|duration`]: 900,
        [`locator('#gone')|click|0|duration`]: 5,
      },
    })
    const result = plan(inputWith({ comparison }))
    expect(result.files).toHaveLength(1)
    const after = result.files[0]!.after
    expect(after).toContain(
      ".click({ move: { duration: 1200 }, editId: 'click1' })"
    )
    expect(after).toContain(".fill('Jane', { editId: 'fill1', duration: 900 })")
    expect(result.applied).toHaveLength(2)
    expect(result.fallback.comparison.videos[0]!.overrides).toEqual([
      expect.objectContaining({ kind: 'stale', selector: "locator('#gone')" }),
    ])
    expect(result.fullyAppliedVideos).toEqual([])
  })

  it('never guesses: unstamped records go to the fallback', () => {
    const unstamped: ActionParamsSnapshot = {
      version: 1,
      videos: {
        Demo: [
          {
            selector: SAVE_SELECTOR,
            method: 'click',
            occurrence: 0,
            params: { 'move.duration': { value: 500, source: 'explicit' } },
          },
        ],
      },
    }
    const comparison = compareWebStateToSnapshot(unstamped, {
      Demo: { [`${SAVE_SELECTOR}|click|0|move.duration`]: 1200 },
    })
    const result = plan(inputWith({ comparison, actionSnapshot: unstamped }))
    expect(result.files).toHaveLength(0)
    expect(result.fallback.comparison.videos[0]!.overrides).toHaveLength(1)
  })

  it('refuses when the slug sits on a different method', () => {
    const wrongMethod: ActionParamsSnapshot = {
      version: 1,
      videos: {
        Demo: [
          {
            selector: SAVE_SELECTOR,
            method: 'click',
            occurrence: 0,
            editId: 'fill1', // slug points at the fill call in the source
            params: { 'move.duration': { value: 500, source: 'explicit' } },
          },
        ],
      },
    }
    const comparison = compareWebStateToSnapshot(wrongMethod, {
      Demo: { [`${SAVE_SELECTOR}|click|0|move.duration`]: 1200 },
    })
    const result = plan(inputWith({ comparison, actionSnapshot: wrongMethod }))
    expect(result.files).toHaveLength(0)
    expect(result.fallback.comparison.videos[0]!.overrides).toHaveLength(1)
  })
})

describe('planCodeSync: timeline param edits', () => {
  it('inserts waitForTimeout before the slugged action for sleepBefore', () => {
    const result = plan(
      inputWith({
        editableOverrides: {
          Demo: [{ key: 'click1', values: { sleepBefore: 500 } }],
        },
      })
    )
    const after = result.files[0]!.after
    expect(after).toContain(
      [
        '      await page.waitForTimeout(500)',
        "      await page.getByRole('button', { name: 'Save' }).click",
      ].join('\n')
    )
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })

  it('updates an existing waitForTimeout instead of stacking', () => {
    const withWait = SOURCE.replace(
      "      await page.getByRole('button', { name: 'Save' }).click",
      [
        '      await page.waitForTimeout(500)',
        "      await page.getByRole('button', { name: 'Save' }).click",
      ].join('\n')
    )
    const result = plan(
      inputWith({
        editableOverrides: {
          Demo: [{ key: 'click1', values: { sleepBefore: 800 } }],
        },
      }),
      { [FILE]: withWait }
    )
    const after = result.files[0]!.after
    expect(after).toContain('await page.waitForTimeout(800)')
    expect(after.match(/waitForTimeout/g)).toHaveLength(1)
  })

  it('sets autoZoom offsets on the slugged block', () => {
    const result = plan(
      inputWith({
        editableOverrides: {
          Demo: [
            { key: 'autoZoom1', values: { startOffset: -200, endOffset: 300 } },
          ],
        },
      })
    )
    const after = result.files[0]!.after
    expect(after).toContain(
      "{ editId: 'autoZoom1', startOffset: -200, endOffset: 300 }"
    )
    expect(result.applied).toHaveLength(2)
  })

  it('skips fields equal to the recorded defaults', () => {
    const result = plan(
      inputWith({
        editableOverrides: {
          Demo: [{ key: 'click1', values: { sleepBefore: 0 } }],
        },
      })
    )
    expect(result.files).toHaveLength(0)
    expect(result.fallback.overrides).toEqual({})
  })

  it('routes unstamped keys, loop keys, and unknown fields to the fallback', () => {
    const result = plan(
      inputWith({
        editableOverrides: {
          Demo: [
            { key: 'click1', values: { mysteryField: 5 } },
            { key: 'click1#1', values: { sleepBefore: 250 } },
            {
              key: 'input|click|getByRole(button, name=Gone)|0',
              values: { sleepBefore: 250 },
            },
          ],
        },
      })
    )
    expect(result.files).toHaveLength(0)
    expect(result.fallback.overrides['Demo']).toEqual([
      { key: 'click1', values: { mysteryField: 5 } },
      { key: 'click1#1', values: { sleepBefore: 250 } },
      {
        key: 'input|click|getByRole(button, name=Gone)|0',
        values: { sleepBefore: 250 },
      },
    ])
    expect(result.fullyAppliedVideos).toEqual([])
  })
})

describe('planCodeSync: editId lookups survive line drift', () => {
  it('locates by slug even when snapshot lines are wrong', () => {
    const drifted: EditableSnapshot = {
      version: 1,
      videos: {
        Demo: EDITABLE_SNAPSHOT.videos['Demo']!.map((entry) => ({
          ...entry,
          source: { file: FILE, line: 1 },
        })),
      },
    }
    const result = plan(
      inputWith({
        editableSnapshot: drifted,
        editableOverrides: {
          Demo: [
            { key: 'click1', values: { sleepBefore: 500 } },
            { key: 'autoZoom1', values: { startOffset: -200 } },
          ],
        },
      })
    )
    const after = result.files[0]!.after
    expect(after).toContain('await page.waitForTimeout(500)')
    expect(after).toContain("{ editId: 'autoZoom1', startOffset: -200 }")
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })
})

describe('planCodeSync: placed events', () => {
  const zoomEvent: PlacedEvent = {
    type: 'placedEvent',
    id: 'e1',
    kind: 'zoom',
    anchor: {
      ref: { type: 'action', key: 'click1' },
      edge: 'start',
      offsetMs: -400,
    },
    end: { durationMs: 1000 },
    props: { amount: 0.6 },
  }

  it('inserts a placeZoom call after the slugged action and imports it', () => {
    const result = plan(inputWith({ placedEvents: { Demo: [zoomEvent] } }))
    const after = result.files[0]!.after
    expect(after).toContain(
      "import { video, autoZoom, placeZoom } from 'screenci'"
    )
    expect(after).toContain(
      "placeZoom({ from: { action: 'click1', edge: 'start' }, " +
        'offsetMs: -400, durationMs: 1000, amount: 0.6 })'
    )
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })

  it('inserts a timestamp marker at a zero-offset action anchor', () => {
    const event: PlacedEvent = {
      type: 'placedEvent',
      id: 't1',
      kind: 'timestamp',
      anchor: {
        ref: { type: 'action', key: 'click1' },
        edge: 'end',
        offsetMs: 0,
      },
      props: { name: 'saved' },
    }
    const result = plan(inputWith({ placedEvents: { Demo: [event] } }))
    const after = result.files[0]!.after
    expect(after).toContain("await timestamp('saved')")
    expect(after).toContain(
      "import { video, autoZoom, timestamp } from 'screenci'"
    )
  })

  it('anchors span events to any stamped action when the anchor is not an action', () => {
    const videoStartZoom: PlacedEvent = {
      ...zoomEvent,
      id: 'e2',
      anchor: { ref: { type: 'videoStart' }, edge: 'start', offsetMs: 500 },
    }
    const result = plan(inputWith({ placedEvents: { Demo: [videoStartZoom] } }))
    expect(result.files[0]!.after).toContain(
      "placeZoom({ from: 'video:start', offsetMs: 500, durationMs: 1000, amount: 0.6 })"
    )
  })

  it('routes events without a stamped anchor to the fallback', () => {
    const unstamped: EditableSnapshot = {
      version: 1,
      videos: {
        Demo: [
          {
            key: 'input|click|getByRole(button, name=Save)|0',
            locked: false,
            defaults: {},
            source: { file: FILE, line: 6 },
          },
        ],
      },
    }
    const offsetTimestamp: PlacedEvent = {
      type: 'placedEvent',
      id: 't2',
      kind: 'timestamp',
      anchor: {
        ref: { type: 'action', key: 'click1' },
        edge: 'end',
        offsetMs: 350,
      },
      props: { name: 'later' },
    }
    const cue: PlacedEvent = {
      type: 'placedEvent',
      id: 'c1',
      kind: 'narrationCue',
      anchor: { ref: { type: 'videoStart' }, edge: 'start', offsetMs: 1000 },
      props: { name: 'intro' },
    }
    const result = plan(
      inputWith({
        editableSnapshot: unstamped,
        placedEvents: { Demo: [zoomEvent, offsetTimestamp, cue] },
      })
    )
    expect(result.files).toHaveLength(0)
    expect(result.fallback.placed['Demo']).toHaveLength(3)
    expect(result.fullyAppliedVideos).toEqual([])
  })
})

describe('planCodeSync: renames', () => {
  it('applies renames last, by replacing the slug literal', () => {
    const result = plan(
      inputWith({
        editableOverrides: {
          Demo: [{ key: 'click1', values: { sleepBefore: 500 } }],
        },
        renames: { Demo: [{ editId: 'click1', newEditId: 'save-button' }] },
      })
    )
    const after = result.files[0]!.after
    expect(after).toContain("editId: 'save-button'")
    expect(after).toContain('await page.waitForTimeout(500)')
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })

  it('routes invalid or unlocatable renames to the fallback', () => {
    const result = plan(
      inputWith({
        renames: {
          Demo: [
            { editId: 'click1', newEditId: "bad'\nslug" },
            { editId: 'ghost9', newEditId: 'fine' },
          ],
        },
      })
    )
    expect(result.files).toHaveLength(0)
    expect(result.fallback.renames['Demo']).toHaveLength(2)
  })
})

describe('planCodeSync: combined edits on one file', () => {
  it('applies slug-keyed edits of every channel together', () => {
    const comparison = compareWebStateToSnapshot(ACTION_SNAPSHOT, {
      Demo: { [`${SAVE_SELECTOR}|click|0|move.duration`]: 1200 },
    })
    const result = plan(
      inputWith({
        comparison,
        editableOverrides: {
          Demo: [
            { key: 'click1', values: { sleepBefore: 500 } },
            { key: 'autoZoom1', values: { startOffset: -200 } },
          ],
        },
      })
    )
    const after = result.files[0]!.after
    expect(after).toContain('await page.waitForTimeout(500)')
    expect(after).toContain('duration: 1200')
    expect(after).toContain("{ editId: 'autoZoom1', startOffset: -200 }")
    expect(result.applied).toHaveLength(3)
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })
})
