import { describe, expect, it } from 'vitest'
import { createRebaselineGate } from './rebaselineGate.js'

describe('createRebaselineGate', () => {
  it('excludes record-pending files from re-baselines until a record runs', () => {
    const gate = createRebaselineGate()
    // The add-language sequence: the languages edit (requires a record)
    // rewrites the file, then five narration edits (render-time) rewrite it
    // too. Their re-baseline must NOT cover the file, or the needed record
    // is silently swallowed.
    gate.noteRecordRequired(['/proj/a.screenci.ts'])
    expect(
      gate.rebaselinablePaths(['/proj/a.screenci.ts', '/proj/b.screenci.ts'])
    ).toEqual(['/proj/b.screenci.ts'])

    gate.clearAfterRecord()
    expect(
      gate.rebaselinablePaths(['/proj/a.screenci.ts', '/proj/b.screenci.ts'])
    ).toEqual(['/proj/a.screenci.ts', '/proj/b.screenci.ts'])
  })

  it('passes everything through when nothing is record-pending', () => {
    const gate = createRebaselineGate()
    expect(gate.rebaselinablePaths(['/proj/a.ts'])).toEqual(['/proj/a.ts'])
  })
})
