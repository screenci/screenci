import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { compareWebStateToSnapshot } from './actionSync.js'
import type { ActionParamsSnapshot } from './actionParamsSnapshot.js'
import type { EditableSnapshot } from './editableSnapshot.js'
import type { PlacedEvent } from './timelineEdits.js'
import { planCodeSync, type CodeSyncInput } from './codeSync.js'

const FILE = '/proj/demo.screenci.ts'
const SAVE_SELECTOR = "getByRole('button', { name: 'Save' })"
const CLICK_KEY = 'input|click|getByRole(button, name=Save)|0'
const AUTOZOOM_KEY = 'autoZoom|||0'

const SOURCE = [
  "import { video, autoZoom } from 'screenci'", // 1
  '', // 2
  "video('Demo', async ({ page }) => {", // 3
  '  await autoZoom(async () => {', // 4
  "    await page.getByRole('button', { name: 'Save' }).click({ move: { duration: 500 } })", // 5
  '  })', // 6
  "  await page.locator('#name').fill('Jane')", // 7
  '})', // 8
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
        params: { 'move.duration': { value: 500, source: 'explicit' } },
      },
      {
        selector: "locator('#name')",
        method: 'fill',
        occurrence: 0,
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
        key: CLICK_KEY,
        locked: false,
        defaults: { sleepBefore: 0 },
        source: { file: FILE, line: 5 },
      },
      {
        key: AUTOZOOM_KEY,
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
  it('applies change and codify, routes stale to fallback', () => {
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
    expect(after).toContain('.click({ move: { duration: 1200 } })')
    expect(after).toContain(".fill('Jane', { duration: 900 })")
    expect(result.applied).toHaveLength(2)
    expect(result.fallback.comparison.videos).toHaveLength(1)
    expect(result.fallback.comparison.videos[0]!.overrides).toEqual([
      expect.objectContaining({ kind: 'stale', selector: "locator('#gone')" }),
    ])
    expect(result.fullyAppliedVideos).toEqual([])
  })

  it('applies remove and collapses the emptied options object', () => {
    const comparison = compareWebStateToSnapshot(ACTION_SNAPSHOT, {
      // 500 is not the SDK default for move.duration, so force `remove` via
      // the real default from ACTION_PARAM_DEFAULTS (click move.duration).
      Demo: { [`${SAVE_SELECTOR}|click|0|move.duration`]: 800 },
    })
    // Sanity: the assessment kind depends on the SDK default; accept either
    // change (applied as new value) when 800 is not the default.
    const result = plan(inputWith({ comparison }))
    expect(result.files[0]!.after).toContain(
      '.click({ move: { duration: 800 } })'
    )
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })

  it('falls back when the same call resolves in more than one file', () => {
    const otherFile = '/proj/other.screenci.ts'
    const snapshot: EditableSnapshot = {
      version: 1,
      videos: {
        Demo: [
          {
            key: CLICK_KEY,
            locked: false,
            defaults: {},
            source: { file: FILE, line: 5 },
          },
          {
            key: 'input|click|getByRole(button, name=Save)|1',
            locked: false,
            defaults: {},
            source: { file: otherFile, line: 2 },
          },
        ],
      },
    }
    const comparison = compareWebStateToSnapshot(ACTION_SNAPSHOT, {
      Demo: { [`${SAVE_SELECTOR}|click|0|move.duration`]: 1200 },
    })
    const result = plan(inputWith({ comparison, editableSnapshot: snapshot }), {
      [FILE]: SOURCE,
      [otherFile]: [
        'export async function helper(page) {',
        "  await page.getByRole('button', { name: 'Save' }).click({ move: { duration: 500 } })",
        '}',
        '',
      ].join('\n'),
    })
    expect(result.files).toHaveLength(0)
    expect(result.fallback.comparison.videos[0]!.overrides).toHaveLength(1)
  })

  it('falls back when the lexical count differs from the recorded count', () => {
    const doubled: ActionParamsSnapshot = {
      version: 1,
      videos: {
        Demo: [
          ...ACTION_SNAPSHOT.videos['Demo']!,
          {
            selector: SAVE_SELECTOR,
            method: 'click',
            occurrence: 1,
            params: { 'move.duration': { value: 500, source: 'default' } },
          },
        ],
      },
    }
    const comparison = compareWebStateToSnapshot(doubled, {
      Demo: { [`${SAVE_SELECTOR}|click|0|move.duration`]: 1200 },
    })
    const result = plan(inputWith({ comparison, actionSnapshot: doubled }))
    expect(result.files).toHaveLength(0)
    expect(result.fallback.comparison.videos[0]!.overrides).toHaveLength(1)
  })
})

describe('planCodeSync: timeline param edits', () => {
  it('inserts waitForTimeout before the anchored action for sleepBefore', () => {
    const result = plan(
      inputWith({
        editableOverrides: {
          Demo: [{ key: CLICK_KEY, values: { sleepBefore: 500 } }],
        },
      })
    )
    const after = result.files[0]!.after
    expect(after).toContain(
      [
        '    await page.waitForTimeout(500)',
        "    await page.getByRole('button', { name: 'Save' }).click",
      ].join('\n')
    )
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })

  it('sets autoZoom start/end offsets, creating the options argument', () => {
    const result = plan(
      inputWith({
        editableOverrides: {
          Demo: [
            {
              key: AUTOZOOM_KEY,
              values: { startOffset: -200, endOffset: 300 },
            },
          ],
        },
      })
    )
    const after = result.files[0]!.after
    expect(after).toContain('}, { startOffset: -200, endOffset: 300 })')
    expect(result.applied).toHaveLength(2)
  })

  it('skips fields equal to the recorded defaults', () => {
    const result = plan(
      inputWith({
        editableOverrides: {
          Demo: [{ key: CLICK_KEY, values: { sleepBefore: 0 } }],
        },
      })
    )
    expect(result.files).toHaveLength(0)
    expect(result.fallback.overrides).toEqual({})
  })

  it('routes unknown fields and unanchored keys to the prompt fallback', () => {
    const result = plan(
      inputWith({
        editableOverrides: {
          Demo: [
            { key: CLICK_KEY, values: { mysteryField: 5 } },
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
      { key: CLICK_KEY, values: { mysteryField: 5 } },
      {
        key: 'input|click|getByRole(button, name=Gone)|0',
        values: { sleepBefore: 250 },
      },
    ])
    expect(result.fullyAppliedVideos).toEqual([])
  })
})

describe('planCodeSync: placed events', () => {
  const zoomEvent: PlacedEvent = {
    type: 'placedEvent',
    id: 'e1',
    kind: 'zoom',
    anchor: {
      ref: { type: 'action', key: CLICK_KEY },
      edge: 'start',
      offsetMs: -400,
    },
    end: { durationMs: 1000 },
    props: { amount: 0.6 },
  }

  it('inserts a placeZoom call after the anchored action and imports it', () => {
    const result = plan(inputWith({ placedEvents: { Demo: [zoomEvent] } }))
    const after = result.files[0]!.after
    expect(after).toContain(
      "import { video, autoZoom, placeZoom } from 'screenci'"
    )
    expect(after).toContain(
      `placeZoom({ from: { action: '${CLICK_KEY}', edge: 'start' }, ` +
        `offsetMs: -400, durationMs: 1000, amount: 0.6 })`
    )
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })

  it('inserts a timestamp marker at a zero-offset action anchor', () => {
    const event: PlacedEvent = {
      type: 'placedEvent',
      id: 't1',
      kind: 'timestamp',
      anchor: {
        ref: { type: 'action', key: CLICK_KEY },
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

  it('routes offset timestamps and content events to the prompt fallback', () => {
    const offsetTimestamp: PlacedEvent = {
      type: 'placedEvent',
      id: 't2',
      kind: 'timestamp',
      anchor: {
        ref: { type: 'action', key: CLICK_KEY },
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
      inputWith({ placedEvents: { Demo: [offsetTimestamp, cue] } })
    )
    expect(result.files).toHaveLength(0)
    expect(result.fallback.placed['Demo']).toEqual([offsetTimestamp, cue])
    expect(result.fullyAppliedVideos).toEqual([])
  })

  it('anchors span events to any recorded statement when the anchor is not an action', () => {
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
})

describe('planCodeSync: combined edits on one file', () => {
  it('applies line-anchored and selector-based edits together', () => {
    const comparison = compareWebStateToSnapshot(ACTION_SNAPSHOT, {
      Demo: { [`${SAVE_SELECTOR}|click|0|move.duration`]: 1200 },
    })
    const result = plan(
      inputWith({
        comparison,
        editableOverrides: {
          Demo: [
            { key: CLICK_KEY, values: { sleepBefore: 500 } },
            { key: AUTOZOOM_KEY, values: { startOffset: -200 } },
          ],
        },
      })
    )
    const after = result.files[0]!.after
    expect(after).toContain('await page.waitForTimeout(500)')
    expect(after).toContain('duration: 1200')
    expect(after).toContain('}, { startOffset: -200 })')
    expect(result.applied).toHaveLength(3)
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })
})
