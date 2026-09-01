import { describe, expect, it } from 'vitest'

import {
  baseVideoName,
  dedupeAppliedStudioNotices,
  formatStudioNoticeLine,
} from './previewOutput.js'

describe('baseVideoName', () => {
  it('strips a trailing language suffix', () => {
    expect(baseVideoName('Demo [en]')).toBe('Demo')
    expect(baseVideoName('Demo [pt-BR]')).toBe('Demo')
  })

  it('leaves names without a suffix untouched', () => {
    expect(baseVideoName('Demo')).toBe('Demo')
    expect(baseVideoName('Demo [draft] final')).toBe('Demo [draft] final')
  })
})

describe('dedupeAppliedStudioNotices', () => {
  it('dedupes per-language passes by videoId', () => {
    const notices = [
      { videoName: 'Demo [en]', videoId: 'vid_1' },
      { videoName: 'Demo [et]', videoId: 'vid_1' },
      { videoName: 'Other [en]', videoId: 'vid_2' },
    ]
    expect(dedupeAppliedStudioNotices(notices)).toEqual([
      { videoName: 'Demo [en]', videoId: 'vid_1' },
      { videoName: 'Other [en]', videoId: 'vid_2' },
    ])
  })

  it('falls back to the base video name when videoId is missing', () => {
    const notices = [
      { videoName: 'Demo [en]', videoId: null },
      { videoName: 'Demo [et]', videoId: null },
    ]
    expect(dedupeAppliedStudioNotices(notices)).toHaveLength(1)
  })
})

describe('formatStudioNoticeLine', () => {
  it('produces the one-line media notice', () => {
    expect(formatStudioNoticeLine('Demo')).toBe(
      'Editor-uploaded media for "Demo" applies at render time; recordings always run from code.'
    )
  })
})

describe('wording rules', () => {
  it('never uses an em-dash', () => {
    const lines = [formatStudioNoticeLine('Demo')]
    for (const line of lines) {
      expect(line).not.toContain('—')
    }
  })
})
