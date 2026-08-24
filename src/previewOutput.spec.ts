import { describe, expect, it } from 'vitest'

import {
  baseVideoName,
  dedupeAppliedStudioNotices,
  formatAppliedEditLine,
  formatDrainSummary,
  formatStudioNoticeLine,
} from './previewOutput.js'

describe('formatDrainSummary', () => {
  it('is null when nothing was handled and nothing failed', () => {
    expect(formatDrainSummary({ handled: 0, failed: 0 })).toBeNull()
  })

  it('pluralizes the synced count', () => {
    expect(formatDrainSummary({ handled: 1, failed: 0 })).toBe(
      'Synced 1 editor edit into your sources.'
    )
    expect(formatDrainSummary({ handled: 3, failed: 0 })).toBe(
      'Synced 3 editor edits into your sources.'
    )
  })

  it('names failures alongside the synced count', () => {
    expect(formatDrainSummary({ handled: 0, failed: 1 })).toBe(
      'Synced 0 editor edits; 1 edit could not be applied.'
    )
    expect(formatDrainSummary({ handled: 2, failed: 2 })).toBe(
      'Synced 2 editor edits; 2 edits could not be applied.'
    )
  })
})

describe('formatAppliedEditLine', () => {
  const base = {
    editDescription: 'the "intro" narration (en)',
    videoName: 'Demo',
    requiresRecord: true,
  }

  it('names a known author', () => {
    expect(formatAppliedEditLine({ ...base, queuedBy: 'Olli' })).toBe(
      'Applied the "intro" narration (en) to "Demo" (queued by Olli).'
    )
  })

  it('omits the author when unknown, missing, or empty', () => {
    expect(formatAppliedEditLine(base)).toBe(
      'Applied the "intro" narration (en) to "Demo".'
    )
    expect(formatAppliedEditLine({ ...base, queuedBy: 'Unknown user' })).toBe(
      'Applied the "intro" narration (en) to "Demo".'
    )
    expect(formatAppliedEditLine({ ...base, queuedBy: '  ' })).toBe(
      'Applied the "intro" narration (en) to "Demo".'
    )
  })

  it('adds the render-time trailer for edits that need no re-record', () => {
    expect(formatAppliedEditLine({ ...base, requiresRecord: false })).toBe(
      'Applied the "intro" narration (en) to "Demo". Applies at render time, no re-record needed.'
    )
  })
})

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
    const lines = [
      formatDrainSummary({ handled: 2, failed: 1 }),
      formatAppliedEditLine({
        editDescription: 'x',
        videoName: 'y',
        requiresRecord: false,
      }),
      formatStudioNoticeLine('Demo'),
    ]
    for (const line of lines) {
      expect(line).not.toContain('—')
    }
  })
})
