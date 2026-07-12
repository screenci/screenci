import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import type { EditableSnapshot } from './editableSnapshot.js'
import {
  allocateEditId,
  planEditIdStamps,
  type EditIdCounters,
} from './editIdStamp.js'

const FILE = '/proj/demo.screenci.ts'

const SOURCE = [
  "import { video, autoZoom } from 'screenci'", // 1
  '', // 2
  "video('Demo', async ({ page }) => {", // 3
  '  await autoZoom(async () => {', // 4
  "    await page.getByRole('button', { name: 'Save' }).click()", // 5
  '  })', // 6
  "  await page.locator('#name').fill('Jane', { duration: 600 })", // 7
  '})', // 8
  '',
].join('\n')

function counters(initial: Record<string, number> = {}): EditIdCounters {
  return { version: 1, counters: { ...initial } }
}

function snapshotWith(
  entries: EditableSnapshot['videos'][string]
): EditableSnapshot {
  return { version: 1, videos: { Demo: entries } }
}

function stamp(
  snapshot: EditableSnapshot,
  c: EditIdCounters = counters(),
  files: Record<string, string> = { [FILE]: SOURCE }
) {
  return planEditIdStamps(snapshot, c, {
    ts,
    readFile: (path) => files[path] ?? null,
  })
}

describe('allocateEditId', () => {
  it('increments per prefix and never reuses', () => {
    const c = counters({ fill: 2 })
    expect(allocateEditId(c, 'fill')).toBe('fill3')
    expect(allocateEditId(c, 'fill')).toBe('fill4')
    expect(allocateEditId(c, 'click')).toBe('click1')
  })
})

describe('planEditIdStamps', () => {
  it('stamps unstamped actions and blocks, bottom-up', () => {
    const result = stamp(
      snapshotWith([
        {
          key: 'autoZoom|||0',
          locked: false,
          defaults: {},
          source: { file: FILE, line: 4 },
        },
        {
          key: 'input|click|getByRole(button, name=Save)|0',
          locked: false,
          defaults: {},
          source: { file: FILE, line: 5 },
        },
        {
          key: 'input|pressSequentially|locator(#name)|0',
          locked: false,
          defaults: {},
          source: { file: FILE, line: 7 },
        },
      ])
    )
    expect(result.files).toHaveLength(1)
    const after = result.files[0]!.after
    expect(after).toContain(".click({ editId: 'click1' })")
    expect(after).toContain(".fill('Jane', { duration: 600, editId: 'fill1' })")
    expect(after).toContain("}, { editId: 'autoZoom1' })")
    expect(result.stamped).toHaveLength(3)
    expect(result.counters.counters).toEqual({
      click: 1,
      fill: 1,
      autoZoom: 1,
    })
  })

  it('stamps timeline block wrappers after their callback argument', () => {
    const blockSource = [
      "import { video, hide, speed, time } from 'screenci'", // 1
      '', // 2
      "video('Demo', async ({ page }) => {", // 3
      '  await hide(async () => {', // 4
      "    await page.goto('/login')", // 5
      '  })', // 6
      '  await speed(2, async () => {', // 7
      "    await page.locator('#a').click()", // 8
      '  })', // 9
      '  await time(500, async () => {', // 10
      "    await page.locator('#b').click()", // 11
      '  })', // 12
      '})', // 13
      '',
    ].join('\n')
    const result = stamp(
      snapshotWith([
        {
          key: 'hide',
          locked: true,
          defaults: {},
          source: { file: FILE, line: 4 },
        },
        {
          key: 'speed',
          locked: true,
          defaults: {},
          source: { file: FILE, line: 7 },
        },
        {
          key: 'time',
          locked: true,
          defaults: {},
          source: { file: FILE, line: 10 },
        },
      ]),
      counters(),
      { [FILE]: blockSource }
    )
    expect(result.files).toHaveLength(1)
    const after = result.files[0]!.after
    // The options object lands right AFTER the callback argument.
    expect(after).toContain("}, { editId: 'hide1' })")
    expect(after).toContain("}, { editId: 'speed1' })")
    expect(after).toContain("}, { editId: 'time1' })")
    expect(result.counters.counters).toEqual({ hide: 1, speed: 1, time: 1 })
  })

  it('skips entries that already have an editId or no source', () => {
    const result = stamp(
      snapshotWith([
        {
          key: 'fill1',
          editId: 'fill1',
          locked: false,
          defaults: {},
          source: { file: FILE, line: 7 },
        },
        {
          key: 'input|click|getByRole(button, name=Save)|0',
          locked: false,
          defaults: {},
        },
      ])
    )
    expect(result.files).toHaveLength(0)
    expect(result.stamped).toHaveLength(0)
  })

  it('skips loop call sites (same identity, same source, multiple ordinals)', () => {
    const looped = [
      "video('Demo', async ({ page }) => {",
      '  for (const i of [1, 2]) {',
      "    await page.locator('#x').click()",
      '  }',
      '})',
      '',
    ].join('\n')
    const result = stamp(
      snapshotWith([
        {
          key: 'input|click|locator(#x)|0',
          locked: false,
          defaults: {},
          source: { file: FILE, line: 3 },
        },
        {
          key: 'input|click|locator(#x)|1',
          locked: false,
          defaults: {},
          source: { file: FILE, line: 3 },
        },
      ]),
      counters(),
      { [FILE]: looped }
    )
    expect(result.files).toHaveLength(0)
    expect(result.stamped).toHaveLength(0)
  })

  it('shares one slug when two videos anchor the same call site', () => {
    const snapshot: EditableSnapshot = {
      version: 1,
      videos: {
        A: [
          {
            key: 'input|click|getByRole(button, name=Save)|0',
            locked: false,
            defaults: {},
            source: { file: FILE, line: 5 },
          },
        ],
        B: [
          {
            key: 'input|click|getByRole(button, name=Save)|0',
            locked: false,
            defaults: {},
            source: { file: FILE, line: 5 },
          },
        ],
      },
    }
    const result = stamp(snapshot)
    expect(result.files[0]!.after.match(/editId/g)).toHaveLength(1)
    expect(result.stamped).toEqual([
      expect.objectContaining({ videoName: 'A', editId: 'click1' }),
      expect.objectContaining({ videoName: 'B', editId: 'click1' }),
    ])
  })
})
