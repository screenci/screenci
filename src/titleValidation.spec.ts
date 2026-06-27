import { describe, expect, it } from 'vitest'
import {
  findDuplicateTitles,
  formatDuplicateTitlesMessage,
  findSelfReferences,
  findMissingReferences,
  formatDependencyWarnings,
} from './titleValidation.js'

describe('title validation', () => {
  it('fails exact duplicate titles', () => {
    expect(findDuplicateTitles(['My Video', 'My Video'])).toEqual(['My Video'])
  })

  it('allows titles that differ by punctuation', () => {
    expect(findDuplicateTitles(['My Video', 'My!Video'])).toEqual([])
  })

  it('formats a readable duplicate-title error message', () => {
    expect(formatDuplicateTitlesMessage(['My Video'])).toContain(
      'Duplicate test titles detected'
    )
  })

  it('treats videos and screenshots as one namespace (a name reused across mediums is a duplicate)', () => {
    // The discovered titles list mixes both mediums, so a video and a
    // screenshot sharing a name collide here.
    expect(
      findDuplicateTitles(['Intro Clip', 'Full Demo', 'Intro Clip'])
    ).toEqual(['Intro Clip'])
  })
})

describe('dependency reference validation', () => {
  it('detects self-references', () => {
    expect(
      findSelfReferences([
        { from: 'Full Demo', to: 'Full Demo' },
        { from: 'Full Demo', to: 'Intro Clip' },
      ])
    ).toEqual([{ from: 'Full Demo', to: 'Full Demo' }])
  })

  it('detects references to targets missing from the run', () => {
    expect(
      findMissingReferences(
        [
          { from: 'Full Demo', to: 'Intro Clip' },
          { from: 'Full Demo', to: 'Ghost' },
        ],
        ['Full Demo', 'Intro Clip']
      )
    ).toEqual([{ from: 'Full Demo', to: 'Ghost' }])
  })

  it('returns an empty warning string when there is nothing to warn about', () => {
    expect(formatDependencyWarnings([], [])).toBe('')
  })

  it('formats self-reference and missing-reference warnings', () => {
    const message = formatDependencyWarnings(
      [{ from: 'A', to: 'A' }],
      [{ from: 'B', to: 'Ghost' }]
    )
    expect(message).toContain('Dependency warnings:')
    expect(message).toContain('references itself')
    expect(message).toContain('no video or screenshot named "Ghost"')
  })
})
