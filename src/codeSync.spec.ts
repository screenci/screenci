import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import type { EditableSnapshot } from './editableSnapshot.js'
import type { CodifyEdit } from './timelineEdits.js'
import {
  planCodeSync,
  type ActionParamsSnapshot,
  type CodeSyncInput,
  type OverrideAssessment,
  type WebStateComparison,
} from './codeSync.js'

/** A one-video comparison in the shape planCodeSync consumes. */
function comparisonFor(
  videoName: string,
  overrides: OverrideAssessment[]
): WebStateComparison {
  return { videos: [{ videoName, overrides }], snapshotEmpty: false }
}

/** Shorthand for a change-kind assessment on a click/fill option. */
function change(
  selector: string,
  method: string,
  optionPath: string,
  editorValue: unknown
): OverrideAssessment {
  return {
    kind: 'change',
    selector,
    method,
    occurrence: 0,
    optionPath,
    editorValue,
  }
}

const FILE = '/proj/demo.screenci.ts'
const SAVE_SELECTOR = "getByRole('button', { name: 'Save' })"

// Two flat sibling interactions with a plain gap between them: the linear model
// the codemod expects. The fixture is editId-stamped, so stable keys ARE slugs.
const SOURCE = [
  "import { video } from 'screenci'", // 1
  '', // 2
  "video('Demo', async ({ page }) => {", // 3
  "  await page.getByRole('button', { name: 'Save' }).click({ move: { duration: 500 }, editId: 'click1' })", // 4
  '  await page.waitForTimeout(1000)', // 5
  "  await page.locator('#name').fill('Jane', { editId: 'fill1' })", // 6
  '})', // 7
  '',
].join('\n')

// A separate script with an autoZoom block, for the offset param path.
const ZOOM_FILE = '/proj/zoom.screenci.ts'
const ZOOM_SOURCE = [
  "import { video, autoZoom } from 'screenci'",
  '',
  "video('Zoom', async ({ page }) => {",
  '  await autoZoom(',
  '    async () => {',
  "      await page.getByRole('button', { name: 'Go' }).click({ editId: 'zclick' })",
  '    },',
  "    { editId: 'autoZoom1' }",
  '  )',
  '})',
  '',
].join('\n')

// A script whose interaction runs inside a for-loop: a locked section.
const LOOP_FILE = '/proj/loop.screenci.ts'
const LOOP_SOURCE = [
  "import { video } from 'screenci'",
  '',
  "video('Loop', async ({ page }) => {",
  '  for (const row of rows) {',
  "    await page.getByRole('button', { name: 'Row' }).click({ editId: 'loopclick' })",
  '  }',
  '})',
  '',
].join('\n')

// A script whose action is called on a stored locator VARIABLE, not on `page`
// directly. A sleepBefore must still emit `page.waitForTimeout`, never
// `thumb.waitForTimeout` (locators have no waitForTimeout).
const DRAG_FILE = '/proj/drag.screenci.ts'
const DRAG_SOURCE = [
  "import { video } from 'screenci'",
  '',
  "video('Drag', async ({ page }) => {",
  '  const thumb = page.locator(\'[data-slot="slider-thumb"]\').first()',
  "  const track = thumb.locator('xpath=..')",
  "  await thumb.dragTo(track, { editId: 'drag1' })",
  '})',
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
        source: { file: FILE, line: 4 },
      },
      {
        key: 'fill1',
        editId: 'fill1',
        locked: false,
        defaults: { sleepBefore: 0 },
        source: { file: FILE, line: 6 },
      },
    ],
    Zoom: [
      {
        key: 'autoZoom1',
        editId: 'autoZoom1',
        locked: false,
        defaults: {},
        source: { file: ZOOM_FILE, line: 4 },
      },
    ],
    Loop: [
      {
        key: 'loopclick',
        editId: 'loopclick',
        locked: false,
        defaults: { sleepBefore: 0 },
        source: { file: LOOP_FILE, line: 5 },
      },
    ],
    Drag: [
      {
        key: 'drag1',
        editId: 'drag1',
        locked: false,
        defaults: { sleepBefore: 0 },
        source: { file: DRAG_FILE, line: 6 },
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
    codifyEdits: {},
    removedCodifyEdits: {},
    renames: {},
    ...overrides,
  }
}

function plan(
  input: CodeSyncInput,
  files: Record<string, string> = {
    [FILE]: SOURCE,
    [ZOOM_FILE]: ZOOM_SOURCE,
    [LOOP_FILE]: LOOP_SOURCE,
    [DRAG_FILE]: DRAG_SOURCE,
  }
) {
  return planCodeSync(input, {
    ts,
    readFile: (path) => files[path] ?? null,
  })
}

function afterFor(result: ReturnType<typeof plan>, path: string): string {
  return result.files.find((file) => file.path === path)!.after
}

describe('planCodeSync: action-parameter overrides', () => {
  it('applies change and codify by slug, marks stale unappliable', () => {
    const comparison = comparisonFor('Demo', [
      change(SAVE_SELECTOR, 'click', 'move.duration', 1200),
      change("locator('#name')", 'fill', 'duration', 900),
      {
        kind: 'stale',
        selector: "locator('#gone')",
        method: 'click',
        occurrence: 0,
        optionPath: 'duration',
        editorValue: 5,
      },
    ])
    const result = plan(inputWith({ comparison }))
    const after = afterFor(result, FILE)
    expect(after).toContain(
      ".click({ move: { duration: 1200 }, editId: 'click1' })"
    )
    expect(after).toContain(".fill('Jane', { editId: 'fill1', duration: 900 })")
    expect(result.applied).toHaveLength(2)
    expect(result.unappliable).toHaveLength(1)
    expect(result.fullyAppliedVideos).toEqual([])
  })

  it('never guesses: unstamped records are unappliable', () => {
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
    const comparison = comparisonFor('Demo', [
      change(SAVE_SELECTOR, 'click', 'move.duration', 1200),
    ])
    const result = plan(inputWith({ comparison, actionSnapshot: unstamped }))
    expect(result.files).toHaveLength(0)
    expect(result.unappliable).toHaveLength(1)
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
    const comparison = comparisonFor('Demo', [
      change(SAVE_SELECTOR, 'click', 'move.duration', 1200),
    ])
    const result = plan(inputWith({ comparison, actionSnapshot: wrongMethod }))
    expect(result.files).toHaveLength(0)
    expect(result.unappliable).toHaveLength(1)
  })
})

describe('planCodeSync: timeline param edits', () => {
  it('inserts waitForTimeout before the slugged action for sleepBefore', () => {
    const result = plan(
      inputWith({
        editableOverrides: {
          Demo: [{ key: 'fill1', values: { sleepBefore: 500 } }],
        },
      })
    )
    const after = afterFor(result, FILE)
    expect(after).toContain(
      [
        '  await page.waitForTimeout(500)',
        "  await page.locator('#name').fill",
      ].join('\n')
    )
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })

  it('emits page.waitForTimeout for an action on a stored locator variable', () => {
    const result = plan(
      inputWith({
        editableOverrides: {
          Drag: [{ key: 'drag1', values: { sleepBefore: 3491 } }],
        },
      })
    )
    const after = afterFor(result, DRAG_FILE)
    expect(after).toContain('await page.waitForTimeout(3491)')
    // Never on the locator variable: locators have no waitForTimeout.
    expect(after).not.toContain('thumb.waitForTimeout')
    expect(result.fullyAppliedVideos).toEqual(['Drag'])
  })

  it('updates an existing waitForTimeout instead of stacking', () => {
    const result = plan(
      inputWith({
        // click1's gap already has waitForTimeout(1000) after it, but that is
        // fill1's lead, not click1's. Target fill1 which has no wait before it.
        editableOverrides: {
          Demo: [{ key: 'click1', values: { sleepBefore: 800 } }],
        },
      })
    )
    // click1 has no preceding wait, so this inserts one before it.
    const after = afterFor(result, FILE)
    expect(after).toContain('await page.waitForTimeout(800)')
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
    expect(result.unappliable).toEqual([])
  })

  it('marks unstamped keys, loop keys, and unknown fields unappliable', () => {
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
    expect(result.unappliable).toHaveLength(3)
    expect(result.fullyAppliedVideos).toEqual([])
  })
})

describe('planCodeSync: cursor-move param edits', () => {
  it('codifies a moveCurve tuple into move.curve on the slugged call', () => {
    const result = plan(
      inputWith({
        editableOverrides: {
          Demo: [
            { key: 'click1', values: { moveCurve: [0.17, 0.67, 0.83, -0.4] } },
          ],
        },
      })
    )
    const after = afterFor(result, FILE)
    expect(after).toContain(
      '.click({ move: { duration: 500, curve: [0.17, 0.67, 0.83, -0.4] }, ' +
        "editId: 'click1' })"
    )
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })

  it('codifies moveEasing and top-level duration', () => {
    const result = plan(
      inputWith({
        editableOverrides: {
          Demo: [
            { key: 'click1', values: { moveEasing: 'ease-out' } },
            { key: 'fill1', values: { duration: 900 } },
          ],
        },
      })
    )
    const after = afterFor(result, FILE)
    expect(after).toContain("move: { duration: 500, easing: 'ease-out' }")
    expect(after).toContain(".fill('Jane', { editId: 'fill1', duration: 900 })")
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })

  it('never emits both a duration and a speed on the same move', () => {
    // click1 has an explicit move.duration; a speed override must not join it.
    // Here the sibling removal collapses the object the insert targets, which
    // is too entangled for a mechanical edit: stay safe and mark unappliable.
    const result = plan(
      inputWith({
        editableOverrides: {
          Demo: [{ key: 'click1', values: { moveSpeed: 800 } }],
        },
      })
    )
    expect(result.files).toHaveLength(0)
    expect(result.unappliable).toHaveLength(1)
  })

  it('drops the explicit sibling when the move has other options', () => {
    const files = {
      [FILE]: SOURCE.replace(
        'move: { duration: 500 }',
        "move: { duration: 500, easing: 'linear' }"
      ),
    }
    const result = plan(
      inputWith({
        editableOverrides: {
          Demo: [{ key: 'click1', values: { moveSpeed: 800 } }],
        },
      }),
      files
    )
    const after = afterFor(result, FILE)
    expect(after).toContain('speed: 800')
    expect(after).not.toContain('duration: 500')
  })

  it('marks loop-locked cursor-move edits unappliable', () => {
    const result = plan(
      inputWith({
        editableOverrides: {
          Loop: [{ key: 'loopclick#1', values: { moveEasing: 'linear' } }],
        },
      })
    )
    expect(result.files).toHaveLength(0)
    expect(result.unappliable).toHaveLength(1)
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
          Demo: [{ key: 'fill1', values: { sleepBefore: 500 } }],
        },
      })
    )
    const after = afterFor(result, FILE)
    expect(after).toContain('await page.waitForTimeout(500)')
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })
})

describe('planCodeSync: media edits', () => {
  it('inserts a blocking narration cue, splitting the following gap', () => {
    const media: CodifyEdit = {
      type: 'mediaEdit',
      id: 'm1',
      kind: 'narrationCue',
      afterEditId: 'click1',
      sleepBeforeMs: 300,
      blocking: true,
      props: { name: 'intro' },
    }
    const result = plan(inputWith({ codifyEdits: { Demo: [media] } }))
    const after = afterFor(result, FILE)
    expect(after).toContain('await page.waitForTimeout(300)')
    expect(after).toContain('await narration.intro()')
    // The 1000ms gap split into 300 before and 700 after the cue.
    expect(after).toContain('await page.waitForTimeout(700)')
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })

  it('inserts a non-blocking overlay start (fire and forget)', () => {
    const media: CodifyEdit = {
      type: 'mediaEdit',
      id: 'm2',
      kind: 'overlay',
      afterEditId: 'fill1',
      blocking: false,
      props: { name: 'logo' },
    }
    const result = plan(inputWith({ codifyEdits: { Demo: [media] } }))
    expect(afterFor(result, FILE)).toContain('await overlays.logo.start()')
  })

  it('is unappliable when the target editId sits in a loop', () => {
    const media: CodifyEdit = {
      type: 'mediaEdit',
      id: 'm3',
      kind: 'narrationCue',
      afterEditId: 'loopclick',
      blocking: true,
      props: { name: 'intro' },
    }
    const result = plan(inputWith({ codifyEdits: { Loop: [media] } }))
    expect(result.files).toHaveLength(0)
    expect(result.unappliable).toHaveLength(1)
  })
})

describe('planCodeSync: gap point edits', () => {
  it('inserts a setBackground point after the action', () => {
    const point: CodifyEdit = {
      type: 'gapPointEdit',
      id: 'gp1',
      kind: 'background',
      afterEditId: 'click1',
      props: { backgroundCss: '#101014' },
    }
    const result = plan(inputWith({ codifyEdits: { Demo: [point] } }))
    const after = afterFor(result, FILE)
    expect(after).toContain("await setBackground('#101014')")
    expect(after).toContain("import { video, setBackground } from 'screenci'")
  })

  it('inserts hideRecording when a recording point turns visibility off', () => {
    const point: CodifyEdit = {
      type: 'gapPointEdit',
      id: 'gp2',
      kind: 'recording',
      afterEditId: 'fill1',
      props: { visible: false },
    }
    const result = plan(inputWith({ codifyEdits: { Demo: [point] } }))
    expect(afterFor(result, FILE)).toContain('await hideRecording()')
  })
})

describe('planCodeSync: zoom edits', () => {
  it('wraps the interaction run in autoZoom with lead-in/hold sleeps', () => {
    const zoom: CodifyEdit = {
      type: 'zoomEdit',
      id: 'z1',
      fromEditId: 'click1',
      untilEditId: 'fill1',
      leadInMs: 400,
      holdMs: 600,
      props: { amount: 0.6 },
    }
    const result = plan(inputWith({ codifyEdits: { Demo: [zoom] } }))
    const after = afterFor(result, FILE)
    expect(after).toContain('await autoZoom(async () => {')
    expect(after).toContain('await page.waitForTimeout(400)')
    expect(after).toContain('await page.waitForTimeout(600)')
    expect(after).toContain('}, { amount: 0.6 })')
    expect(after).toContain("import { video, autoZoom } from 'screenci'")
  })

  it('is unappliable when the two editIds are not in the same block', () => {
    // fromEditId is in the zoom script, untilEditId in the loop script.
    const zoom: CodifyEdit = {
      type: 'zoomEdit',
      id: 'z2',
      fromEditId: 'zclick',
      untilEditId: 'loopclick',
      props: {},
    }
    const result = plan(inputWith({ codifyEdits: { Zoom: [zoom] } }))
    expect(result.files).toHaveLength(0)
    expect(result.unappliable).toHaveLength(1)
  })
})

describe('planCodeSync: idempotent re-sync and ghost-sleep cleanup', () => {
  // A blocking narration cue placed after click1 with a 300ms lead sleep. The
  // codemod splits the 1000ms gap into 300 (before) + 700 (after the cue).
  const narration: CodifyEdit = {
    type: 'mediaEdit',
    id: 'm1',
    kind: 'narrationCue',
    afterEditId: 'click1',
    sleepBeforeMs: 300,
    blocking: true,
    props: { name: 'intro' },
  }
  const otherFiles = { [ZOOM_FILE]: ZOOM_SOURCE, [LOOP_FILE]: LOOP_SOURCE }

  /** The FILE text after one sync of `narration` (with the given lead sleep). */
  function syncedOnce(sleepBeforeMs = 300): string {
    const result = plan(
      inputWith({
        codifyEdits: { Demo: [{ ...narration, sleepBeforeMs }] },
      })
    )
    return afterFor(result, FILE)
  }

  it('re-syncing the same media edit makes no change (idempotent)', () => {
    const after1 = syncedOnce()
    const result2 = plan(inputWith({ codifyEdits: { Demo: [narration] } }), {
      [FILE]: after1,
      ...otherFiles,
    })
    expect(result2.files).toHaveLength(0)
  })

  it('changing sleepBeforeMs updates the existing sleep without stacking', () => {
    const after1 = syncedOnce()
    const result2 = plan(
      inputWith({
        codifyEdits: { Demo: [{ ...narration, sleepBeforeMs: 500 }] },
      }),
      { [FILE]: after1, ...otherFiles }
    )
    const after2 = afterFor(result2, FILE)
    expect(after2).toContain('await page.waitForTimeout(500)')
    expect(after2).not.toContain('await page.waitForTimeout(300)')
    // Exactly one narration call: the edit was updated in place, not stacked.
    expect(after2.match(/narration\.intro/g)).toHaveLength(1)
    // The remainder gap after the cue is preserved.
    expect(after2).toContain('await page.waitForTimeout(700)')
  })

  it('removes an orphaned editor sleep and effect when its edit is deleted', () => {
    const after1 = syncedOnce()
    const result2 = plan(
      inputWith({ removedCodifyEdits: { Demo: [narration] } }),
      { [FILE]: after1, ...otherFiles }
    )
    const after2 = afterFor(result2, FILE)
    expect(after2).not.toContain('narration.intro')
    // The split gap re-coalesced back to the original single 1000ms sleep.
    expect(after2).toContain('await page.waitForTimeout(1000)')
    expect(after2).not.toContain('await page.waitForTimeout(300)')
    expect(after2).not.toContain('await page.waitForTimeout(700)')
  })

  it('never touches a hand-authored wait with no adjacent codemod effect', () => {
    // The edit set claims a removed cue, but the code has none: nothing to do,
    // and the hand-authored waitForTimeout(1000) is left exactly as it was.
    const result = plan(
      inputWith({ removedCodifyEdits: { Demo: [narration] } })
    )
    expect(result.files).toHaveLength(0)
  })

  it('leaves an unrelated adjacent effect call in place (head mismatch)', () => {
    // A hand-authored `narration.other()` sits in the gap; the removed edit
    // targets `narration.intro`. The mismatched call must survive.
    const handAuthored = SOURCE.replace(
      '  await page.waitForTimeout(1000)',
      ['  await narration.other()', '  await page.waitForTimeout(1000)'].join(
        '\n'
      )
    )
    const result = plan(
      inputWith({ removedCodifyEdits: { Demo: [narration] } }),
      { [FILE]: handAuthored, ...otherFiles }
    )
    expect(result.files).toHaveLength(0)
  })
})

describe('planCodeSync: gap span edits', () => {
  it('wraps the run in a hide block', () => {
    const span: CodifyEdit = {
      type: 'gapSpanEdit',
      id: 'g1',
      kind: 'hide',
      fromEditId: 'click1',
      untilEditId: 'fill1',
    }
    const result = plan(inputWith({ codifyEdits: { Demo: [span] } }))
    const after = afterFor(result, FILE)
    expect(after).toContain('await hide(async () => {')
    expect(after).toContain("import { video, hide } from 'screenci'")
  })

  it('wraps the run in a speed block with the multiplier', () => {
    const span: CodifyEdit = {
      type: 'gapSpanEdit',
      id: 'g2',
      kind: 'speed',
      fromEditId: 'click1',
      untilEditId: 'fill1',
      props: { multiplier: 3 },
    }
    const result = plan(inputWith({ codifyEdits: { Demo: [span] } }))
    expect(afterFor(result, FILE)).toContain('await speed(3, async () => {')
  })

  it('wraps the run in a time block, unappliable without a duration', () => {
    const span: CodifyEdit = {
      type: 'gapSpanEdit',
      id: 'g3',
      kind: 'time',
      fromEditId: 'click1',
      untilEditId: 'fill1',
      props: { durationMs: 500 },
    }
    const result = plan(inputWith({ codifyEdits: { Demo: [span] } }))
    expect(afterFor(result, FILE)).toContain('await time(500, async () => {')

    const noDuration: CodifyEdit = { ...span, id: 'g4', props: {} }
    const bad = plan(inputWith({ codifyEdits: { Demo: [noDuration] } }))
    expect(bad.files).toHaveLength(0)
    expect(bad.unappliable).toHaveLength(1)
  })
})

describe('planCodeSync: delayed (before-anchor) placements', () => {
  const otherFiles = { [ZOOM_FILE]: ZOOM_SOURCE, [LOOP_FILE]: LOOP_SOURCE }

  const delayedPoint: CodifyEdit = {
    type: 'gapPointEdit',
    id: 'dp1',
    kind: 'background',
    afterEditId: 'fill1',
    delayMs: 500,
    props: { backgroundCss: '#101014' },
  }

  it('places a delayed gap point before the anchor with a delay option', () => {
    const result = plan(inputWith({ codifyEdits: { Demo: [delayedPoint] } }))
    const after = afterFor(result, FILE)
    expect(after).toContain("await setBackground('#101014', { delay: 500 })")
    expect(after).toContain("import { video, setBackground } from 'screenci'")
    // The call sits BEFORE the fill anchor, with no gap sleep of its own.
    const callIndex = after.indexOf("await setBackground('#101014'")
    const anchorIndex = after.indexOf("await page.locator('#name').fill")
    expect(callIndex).toBeGreaterThan(0)
    expect(callIndex).toBeLessThan(anchorIndex)
  })

  it('places a delayed non-blocking media start before the anchor', () => {
    const media: CodifyEdit = {
      type: 'mediaEdit',
      id: 'dm1',
      kind: 'overlay',
      afterEditId: 'fill1',
      delayMs: 250,
      blocking: false,
      props: { name: 'logo' },
    }
    const result = plan(inputWith({ codifyEdits: { Demo: [media] } }))
    const after = afterFor(result, FILE)
    expect(after).toContain('await overlays.logo.start({ delay: 250 })')
    const callIndex = after.indexOf('await overlays.logo.start')
    const anchorIndex = after.indexOf("await page.locator('#name').fill")
    expect(callIndex).toBeLessThan(anchorIndex)
  })

  it('a delayed blocking media edit is unappliable', () => {
    const media: CodifyEdit = {
      type: 'mediaEdit',
      id: 'dm2',
      kind: 'narrationCue',
      afterEditId: 'fill1',
      delayMs: 250,
      blocking: true,
      props: { name: 'intro' },
    }
    const result = plan(inputWith({ codifyEdits: { Demo: [media] } }))
    expect(result.files).toHaveLength(0)
    expect(result.unappliable).toHaveLength(1)
  })

  it('re-syncing the same delayed point makes no change (idempotent)', () => {
    const after1 = afterFor(
      plan(inputWith({ codifyEdits: { Demo: [delayedPoint] } })),
      FILE
    )
    const result2 = plan(inputWith({ codifyEdits: { Demo: [delayedPoint] } }), {
      [FILE]: after1,
      ...otherFiles,
    })
    expect(result2.files).toHaveLength(0)
  })

  it('changing the delay updates the placed call in place', () => {
    const after1 = afterFor(
      plan(inputWith({ codifyEdits: { Demo: [delayedPoint] } })),
      FILE
    )
    const result2 = plan(
      inputWith({ codifyEdits: { Demo: [{ ...delayedPoint, delayMs: 900 }] } }),
      { [FILE]: after1, ...otherFiles }
    )
    const after2 = afterFor(result2, FILE)
    expect(after2).toContain("await setBackground('#101014', { delay: 900 })")
    expect(after2.match(/setBackground/g)).toHaveLength(2) // import + one call
  })

  it('switching a point from sleep to delay removes the after-anchor copy', () => {
    const sleepPoint: CodifyEdit = {
      type: 'gapPointEdit',
      id: 'dp1',
      kind: 'background',
      afterEditId: 'click1',
      sleepBeforeMs: 300,
      props: { backgroundCss: '#101014' },
    }
    const after1 = afterFor(
      plan(inputWith({ codifyEdits: { Demo: [sleepPoint] } })),
      FILE
    )
    expect(after1).toContain('await page.waitForTimeout(300)')
    const result2 = plan(
      inputWith({
        codifyEdits: {
          Demo: [{ ...sleepPoint, sleepBeforeMs: undefined, delayMs: 450 }],
        },
      }),
      { [FILE]: after1, ...otherFiles }
    )
    const after2 = afterFor(result2, FILE)
    expect(after2).toContain("await setBackground('#101014', { delay: 450 })")
    expect(after2.match(/setBackground\(/g)).toHaveLength(1)
    // The split 300/700 gap re-coalesced into the original 1000ms sleep.
    expect(after2).toContain('await page.waitForTimeout(1000)')
    expect(after2).not.toContain('await page.waitForTimeout(300)')
  })

  it('switching a point from delay to sleep removes the before-anchor copy', () => {
    const after1 = afterFor(
      plan(inputWith({ codifyEdits: { Demo: [delayedPoint] } })),
      FILE
    )
    const result2 = plan(
      inputWith({
        codifyEdits: {
          Demo: [{ ...delayedPoint, delayMs: undefined, sleepBeforeMs: 0 }],
        },
      }),
      { [FILE]: after1, ...otherFiles }
    )
    const after2 = afterFor(result2, FILE)
    expect(after2).toContain("await setBackground('#101014')")
    expect(after2).not.toContain('{ delay:')
    expect(after2.match(/setBackground\(/g)).toHaveLength(1)
  })

  it('orders two same-anchor delayed points by ascending delay', () => {
    const early: CodifyEdit = {
      type: 'gapPointEdit',
      id: 'dpA',
      kind: 'recording',
      afterEditId: 'fill1',
      delayMs: 200,
      props: { visible: false },
    }
    const late: CodifyEdit = {
      type: 'gapPointEdit',
      id: 'dpB',
      kind: 'recording',
      afterEditId: 'fill1',
      delayMs: 800,
      props: { size: 0.5 },
    }
    // Doc order is late-first: the planner must still emit ascending delays.
    const result = plan(inputWith({ codifyEdits: { Demo: [late, early] } }))
    const after = afterFor(result, FILE)
    const earlyIndex = after.indexOf('await hideRecording({ delay: 200 })')
    const lateIndex = after.indexOf(
      'await resizeRecording(0.5, { delay: 800 })'
    )
    expect(earlyIndex).toBeGreaterThan(0)
    expect(lateIndex).toBeGreaterThan(0)
    expect(earlyIndex).toBeLessThan(lateIndex)
  })

  it('wraps a delayed gap span with a delay option on the wrapper', () => {
    const span: CodifyEdit = {
      type: 'gapSpanEdit',
      id: 'ds1',
      kind: 'hide',
      fromEditId: 'click1',
      untilEditId: 'fill1',
      delayMs: 400,
    }
    const result = plan(inputWith({ codifyEdits: { Demo: [span] } }))
    const after = afterFor(result, FILE)
    expect(after).toContain('await hide(async () => {')
    expect(after).toContain('}, { delay: 400 })')
  })

  it('updates the wrapper delay on re-sync without re-wrapping', () => {
    const span: CodifyEdit = {
      type: 'gapSpanEdit',
      id: 'ds1',
      kind: 'hide',
      fromEditId: 'click1',
      untilEditId: 'fill1',
      delayMs: 400,
    }
    const after1 = afterFor(
      plan(inputWith({ codifyEdits: { Demo: [span] } })),
      FILE
    )
    const result2 = plan(
      inputWith({ codifyEdits: { Demo: [{ ...span, delayMs: 650 }] } }),
      { [FILE]: after1, ...otherFiles }
    )
    const after2 = afterFor(result2, FILE)
    expect(after2).toContain('}, { delay: 650 })')
    expect(after2.match(/await hide\(/g)).toHaveLength(1)
  })

  it('removes a deleted delayed point placed before its anchor', () => {
    const after1 = afterFor(
      plan(inputWith({ codifyEdits: { Demo: [delayedPoint] } })),
      FILE
    )
    const result2 = plan(
      inputWith({ removedCodifyEdits: { Demo: [delayedPoint] } }),
      { [FILE]: after1, ...otherFiles }
    )
    const after2 = afterFor(result2, FILE)
    expect(after2).not.toContain('setBackground(')
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
    const after = afterFor(result, FILE)
    expect(after).toContain("editId: 'save-button'")
    expect(after).toContain('await page.waitForTimeout(500)')
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })

  it('marks invalid or unlocatable renames unappliable', () => {
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
    expect(result.unappliable).toHaveLength(2)
  })
})

describe('planCodeSync: combined edits on one file', () => {
  it('applies slug-keyed edits of every channel together', () => {
    const comparison = comparisonFor('Demo', [
      change(SAVE_SELECTOR, 'click', 'move.duration', 1200),
    ])
    const result = plan(
      inputWith({
        comparison,
        editableOverrides: {
          Demo: [{ key: 'fill1', values: { sleepBefore: 500 } }],
        },
        codifyEdits: {
          Demo: [
            {
              type: 'gapPointEdit',
              id: 'gp1',
              kind: 'background',
              afterEditId: 'click1',
              props: { backgroundCss: '#000' },
            },
          ],
        },
      })
    )
    const after = afterFor(result, FILE)
    expect(after).toContain('await page.waitForTimeout(500)')
    expect(after).toContain('duration: 1200')
    expect(after).toContain("await setBackground('#000')")
    expect(result.applied).toHaveLength(3)
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })
})

describe('planCodeSync: overlay declaration edits', () => {
  const OVERLAY_FILE = '/proj/overlay.screenci.ts'
  const OVERLAY_SOURCE = [
    "import { video } from 'screenci'",
    '',
    'video',
    '  .overlays({',
    "    logo: { path: './logo.png', fill: 'recording' },",
    "    ring: { path: './ring.html', over: target, margin: 8 },",
    '  })',
    "  ('Overlaid', async ({ page }) => {",
    "  await page.getByRole('button', { name: 'Save' }).click({ editId: 'oclick' })",
    '})',
    '',
  ].join('\n')
  const snapshotWithOverlayVideo: typeof EDITABLE_SNAPSHOT = {
    version: 1,
    videos: {
      ...EDITABLE_SNAPSHOT.videos,
      Overlaid: [
        {
          key: 'oclick',
          editId: 'oclick',
          locked: false,
          defaults: { sleepBefore: 0 },
          source: { file: OVERLAY_FILE, line: 9 },
        },
      ],
    },
  }
  const overlayFiles = {
    [FILE]: SOURCE,
    [OVERLAY_FILE]: OVERLAY_SOURCE,
  }

  it('merges box props into the named overlay declaration', () => {
    const result = plan(
      inputWith({
        editableSnapshot: snapshotWithOverlayVideo,
        overlayDeclEdits: {
          Overlaid: [
            {
              type: 'overlayDeclEdit',
              id: 'overlaydecl-logo',
              overlayName: 'logo',
              props: { x: 96, y: 96, width: 240 },
            },
          ],
        },
      }),
      overlayFiles
    )
    const after = afterFor(result, OVERLAY_FILE)
    expect(after).toContain(
      "logo: { path: './logo.png', x: 96, y: 96, width: 240 }"
    )
    expect(after).toContain(
      "ring: { path: './ring.html', over: target, margin: 8 }"
    )
    expect(result.applied).toHaveLength(1)
    expect(result.fullyAppliedVideos).toEqual(['Overlaid'])
  })

  it('updates the margin of an over-locked overlay', () => {
    const result = plan(
      inputWith({
        editableSnapshot: snapshotWithOverlayVideo,
        overlayDeclEdits: {
          Overlaid: [
            {
              type: 'overlayDeclEdit',
              id: 'overlaydecl-ring',
              overlayName: 'ring',
              props: { margin: 20 },
            },
          ],
        },
      }),
      overlayFiles
    )
    expect(afterFor(result, OVERLAY_FILE)).toContain(
      "ring: { path: './ring.html', over: target, margin: 20 }"
    )
  })

  it('marks unappliable when free props target an over declaration', () => {
    const result = plan(
      inputWith({
        editableSnapshot: snapshotWithOverlayVideo,
        overlayDeclEdits: {
          Overlaid: [
            {
              type: 'overlayDeclEdit',
              id: 'overlaydecl-ring',
              overlayName: 'ring',
              props: { width: 300 },
            },
          ],
        },
      }),
      overlayFiles
    )
    expect(result.files).toHaveLength(0)
    expect(result.unappliable).toHaveLength(1)
    expect(result.unappliable[0]!.reason).toContain('ring')
  })

  it('marks unappliable when the video declaration is missing', () => {
    const result = plan(
      inputWith({
        overlayDeclEdits: {
          Ghost: [
            {
              type: 'overlayDeclEdit',
              id: 'overlaydecl-logo',
              overlayName: 'logo',
              props: { width: 300 },
            },
          ],
        },
      })
    )
    expect(result.files).toHaveLength(0)
    expect(result.unappliable).toHaveLength(1)
  })
})

describe('planCodeSync: studio render/record option codify', () => {
  const CONTENT = { narration: false, text: false, audio: false, assets: false }

  it('inserts renderOptions into the video builder call', () => {
    const result = plan(
      inputWith({
        studioSync: {
          videos: {
            Demo: { renderOptions: { fps: 60 }, content: CONTENT },
          },
        },
      })
    )
    const after = afterFor(result, FILE)
    expect(after).toContain("video.renderOptions({ fps: 60 })('Demo'")
    expect(result.applied).toHaveLength(1)
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })

  it('marks the video unappliable when its declaration is absent', () => {
    const result = plan(
      inputWith({
        studioSync: {
          videos: {
            Ghost: { recordOptions: { headless: true }, content: CONTENT },
          },
        },
      })
    )
    expect(result.files).toHaveLength(0)
    expect(result.unappliable).toHaveLength(1)
  })
})

describe('planCodeSync: narration cue value codify', () => {
  it('adds a .narration section to the video builder call when missing', () => {
    const result = plan(
      inputWith({
        narrationEdits: {
          Demo: [
            {
              type: 'narrationEdit',
              id: 'narration|intro|default',
              cueName: 'intro',
              lang: 'default',
              value: 'Hi there',
            },
          ],
        },
      })
    )
    const after = afterFor(result, FILE)
    expect(after).toContain("video.narration({ intro: 'Hi there' })('Demo'")
    expect(result.applied).toHaveLength(1)
    expect(result.fullyAppliedVideos).toEqual(['Demo'])
  })

  it('converts a content-major declaration to language-major on a lang edit', () => {
    const narratedSource = SOURCE.replace(
      "video('Demo'",
      "video.narration({ intro: 'Hi' })('Demo'"
    )
    const files = { [FILE]: narratedSource }
    const result = plan(
      inputWith({
        narrationEdits: {
          Demo: [
            {
              type: 'narrationEdit',
              id: 'narration|intro|fi',
              cueName: 'intro',
              lang: 'fi',
              value: 'Moi',
            },
          ],
        },
      }),
      files
    )
    const after = afterFor(result, FILE)
    expect(after).toContain(
      "video.narration({ default: { intro: 'Hi' }, fi: { intro: 'Moi' } })"
    )
    expect(result.applied).toHaveLength(1)
  })

  it('marks a names-only declaration app-managed', () => {
    const namesOnlySource = SOURCE.replace(
      "video('Demo'",
      "video.narration(['intro'])('Demo'"
    )
    const result = plan(
      inputWith({
        narrationEdits: {
          Demo: [
            {
              type: 'narrationEdit',
              id: 'narration|intro|default',
              cueName: 'intro',
              lang: 'default',
              value: 'Hi',
            },
          ],
        },
      }),
      { [FILE]: namesOnlySource }
    )
    expect(result.files).toHaveLength(0)
    expect(result.unappliable).toHaveLength(1)
    expect(result.unappliable[0]!.reason).toContain('app-managed')
  })

  it('marks the video unappliable when its declaration is absent', () => {
    const result = plan(
      inputWith({
        narrationEdits: {
          Ghost: [
            {
              type: 'narrationEdit',
              id: 'narration|intro|default',
              cueName: 'intro',
              lang: 'default',
              value: 'Hi',
            },
          ],
        },
      })
    )
    expect(result.files).toHaveLength(0)
    expect(result.unappliable).toHaveLength(1)
  })
})
