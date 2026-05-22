import { describe, expect, it } from 'vitest'
import {
  findDuplicateTitles,
  formatDuplicateTitlesMessage,
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
})
