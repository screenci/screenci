import { describe, expect, it } from 'vitest'
import { buildStudioSyncPrompt, type StudioSyncState } from './studioSync.js'

const emptyContent = {
  narration: false,
  text: false,
  audio: false,
  assets: false,
}

describe('buildStudioSyncPrompt', () => {
  it('returns null when there is nothing to sync', () => {
    expect(buildStudioSyncPrompt({ videos: {} }, 'proj')).toBeNull()
  })

  it('emits SET directives for render and record option leaves', () => {
    const state: StudioSyncState = {
      videos: {
        intro: {
          renderOptions: { output: { aspectRatio: '9:16' } },
          recordOptions: { fps: 30 },
          content: emptyContent,
        },
      },
    }
    const prompt = buildStudioSyncPrompt(state, 'proj')!
    expect(prompt).toContain('## Video: intro')
    expect(prompt).toContain('SET `renderOptions.output.aspectRatio` to "9:16"')
    expect(prompt).toContain('SET `recordOptions.fps` to 30')
    // Record options are applied at record time.
    expect(prompt).toContain('re-record after codifying')
  })

  it('notes content edits without dumping their values', () => {
    const state: StudioSyncState = {
      videos: {
        demo: {
          content: { ...emptyContent, narration: true, text: true },
        },
      },
    }
    const prompt = buildStudioSyncPrompt(state, 'proj')!
    expect(prompt).toContain('NOTE: the editor holds narration edits')
    expect(prompt).toContain('NOTE: the editor holds on-screen text')
    expect(prompt).not.toContain('audio')
  })

  it('skips videos with neither options nor content', () => {
    const state: StudioSyncState = {
      videos: { blank: { content: emptyContent } },
    }
    expect(buildStudioSyncPrompt(state, 'proj')).toBeNull()
  })

  it('treats arrays as leaf values (set wholesale)', () => {
    const state: StudioSyncState = {
      videos: {
        a: {
          renderOptions: { pauses: [100, 200] },
          content: emptyContent,
        },
      },
    }
    const prompt = buildStudioSyncPrompt(state, 'proj')!
    expect(prompt).toContain('SET `renderOptions.pauses` to [100,200]')
  })
})
