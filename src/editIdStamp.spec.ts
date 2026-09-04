import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import type { EditableSnapshot } from './editableSnapshot.js'
import {
  allocateEditId,
  mayHaveDuplicateEditIds,
  planDuplicateEditIdFixes,
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

describe('mayHaveDuplicateEditIds', () => {
  it('is false when every slug is unique', () => {
    expect(
      mayHaveDuplicateEditIds([
        {
          path: '/proj/a.ts',
          text: "click({ editId: 'click1' })\nfill({ editId: 'fill1' })\n",
        },
        { path: '/proj/b.ts', text: "click({ editId: 'click2' })\n" },
      ])
    ).toBe(false)
  })

  it('is true when a slug repeats within one file', () => {
    expect(
      mayHaveDuplicateEditIds([
        {
          path: '/proj/a.ts',
          text: "click({ editId: 'click1' })\nclick({ editId: 'click1' })\n",
        },
      ])
    ).toBe(true)
  })

  it('is true when a slug repeats across files', () => {
    expect(
      mayHaveDuplicateEditIds([
        { path: '/proj/a.ts', text: 'click({ editId: "click1" })\n' },
        { path: '/proj/b.ts', text: "click({ editId: 'click1' })\n" },
      ])
    ).toBe(true)
  })

  it('matches double-quoted and template literals', () => {
    expect(
      mayHaveDuplicateEditIds([
        { path: '/proj/a.ts', text: 'click({ editId: "fill1" })\n' },
        { path: '/proj/b.ts', text: 'click({ editId: `fill1` })\n' },
      ])
    ).toBe(true)
  })

  it('ignores files with no editIds', () => {
    expect(
      mayHaveDuplicateEditIds([
        { path: '/proj/a.ts', text: 'const editIdea = 1\n' },
      ])
    ).toBe(false)
  })
})

describe('planDuplicateEditIdFixes', () => {
  const dup = (
    files: Array<{ path: string; text: string }>,
    c: EditIdCounters = counters()
  ) => planDuplicateEditIdFixes(files, c, { ts })

  it('keeps the first occurrence and re-stamps later duplicates', () => {
    const path = '/proj/dup.screenci.ts'
    const text = [
      "video('Demo', async ({ page }) => {",
      "  await page.getByRole('a').click({ editId: 'click1' })",
      "  await page.getByRole('b').click({ editId: 'click1' })",
      '})',
      '',
    ].join('\n')
    const c = counters({ click: 1 })
    const result = dup([{ path, text }], c)
    expect(result.renamed).toEqual([{ path, from: 'click1', to: 'click2' }])
    // First keeps click1, second becomes click2.
    expect(result.files[0]!.after).toContain(
      "getByRole('a').click({ editId: 'click1' })"
    )
    expect(result.files[0]!.after).toContain(
      "getByRole('b').click({ editId: 'click2' })"
    )
    expect(c.counters.click).toBe(2)
  })

  it('resolves duplicates spread across files, keeping the first path', () => {
    const a = '/proj/a.screenci.ts'
    const b = '/proj/b.screenci.ts'
    const result = dup([
      { path: b, text: "page.getByRole('x').click({ editId: 'click1' })\n" },
      { path: a, text: "page.getByRole('y').click({ editId: 'click1' })\n" },
    ])
    // a sorts before b, so a keeps the slug and b is re-stamped. The counter
    // starts at 0 but click1 is in use, so the allocation skips to click2.
    expect(result.renamed).toEqual([{ path: b, from: 'click1', to: 'click2' }])
    const fixed = result.files.find((f) => f.path === b)!
    expect(fixed.after).toContain("editId: 'click2'")
    expect(result.files.map((f) => f.path)).toEqual([b])
  })

  it('is a no-op when every editId is unique', () => {
    const path = '/proj/ok.screenci.ts'
    const text = [
      "page.getByRole('a').click({ editId: 'click1' })",
      "page.getByRole('b').click({ editId: 'click2' })",
      '',
    ].join('\n')
    const result = dup([{ path, text }])
    expect(result.files).toEqual([])
    expect(result.renamed).toEqual([])
  })

  it('does not touch a genuine loop: one call site is a single occurrence', () => {
    const path = '/proj/loop.screenci.ts'
    const text = [
      'for (const name of names) {',
      "  await page.getByRole(name).click({ editId: 'click1' })",
      '}',
      '',
    ].join('\n')
    const result = dup([{ path, text }])
    expect(result.files).toEqual([])
    expect(result.renamed).toEqual([])
  })

  it('never reuses counter values across resolutions', () => {
    const path = '/proj/dup2.screenci.ts'
    const text = [
      "page.getByRole('a').click({ editId: 'click1' })",
      "page.getByRole('b').click({ editId: 'click1' })",
      "page.getByRole('c').fill('x', { editId: 'fill1' })",
      "page.getByRole('d').fill('y', { editId: 'fill1' })",
      '',
    ].join('\n')
    const c = counters({ click: 5, fill: 2 })
    const result = dup([{ path, text }], c)
    expect(result.renamed).toEqual([
      { path, from: 'click1', to: 'click6' },
      { path, from: 'fill1', to: 'fill3' },
    ])
    expect(c.counters).toEqual({ click: 6, fill: 3 })
  })
})
