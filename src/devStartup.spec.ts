import { describe, expect, it, vi } from 'vitest'

import {
  grepMatcher,
  runDevStartupSync,
  type DevStartupDeps,
  type KeptRecording,
} from './devStartup.js'
import type { RecordingData } from './recordingData.js'

function kept(videoName: string, entry?: string): KeptRecording {
  return {
    entry: entry ?? `${videoName} [en]`,
    data: {
      events: [],
      renderOptions: {} as RecordingData['renderOptions'],
      metadata: {
        videoName,
        screenciVersion: '0.0.0',
      },
    },
  }
}

function makeDeps(
  recordings: KeptRecording[],
  overrides: Partial<DevStartupDeps> = {}
): DevStartupDeps & {
  recordPreview: ReturnType<typeof vi.fn>
} {
  const recordPreview = vi.fn(async () => {})
  return {
    readKeptRecordings: async () => recordings,
    recordPreview,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  }
}

describe('runDevStartupSync', () => {
  it('always records, even when kept recordings exist', async () => {
    const deps = makeDeps([kept('Demo')])
    const result = await runDevStartupSync({ grep: 'Demo' }, deps)

    expect(deps.recordPreview).toHaveBeenCalledWith('Demo')
    expect(result.recorded).toEqual(['Demo'])
  })

  it('records everything with no pattern (undefined grep)', async () => {
    const deps = makeDeps([kept('Demo'), kept('Other')])
    await runDevStartupSync({}, deps)

    expect(deps.recordPreview).toHaveBeenCalledWith(undefined)
    expect(deps.logger.info).toHaveBeenCalledWith('Recording all videos.')
  })

  it('hints how to preview just one video when a formatter is wired', async () => {
    const deps = makeDeps([kept('Demo'), kept('Other')], {
      suggestPreviewCommand: (videoName) =>
        `npx screenci preview "${videoName}"`,
    })
    await runDevStartupSync({}, deps)

    expect(deps.logger.info).toHaveBeenCalledWith(
      'Recording all videos. Preview just one with a command such as npx screenci preview "Demo".'
    )
  })

  it('records with the grep even when no kept recording matches (new video)', async () => {
    const deps = makeDeps([])
    const result = await runDevStartupSync({ grep: 'Brand new' }, deps)

    expect(deps.recordPreview).toHaveBeenCalledWith('Brand new')
    expect(deps.logger.info).toHaveBeenCalledWith('Recording matched videos.')
    expect(result.recorded).toEqual([])
  })

  it('announces one line per video, deduped across language passes', async () => {
    const deps = makeDeps([
      kept('Demo', 'Demo [en]'),
      kept('Demo', 'Demo [fi]'),
      kept('Other'),
    ])
    await runDevStartupSync({ grep: 'Demo|Other' }, deps)

    expect(deps.logger.info).toHaveBeenCalledWith(
      'Recording 2 videos: Demo, Other'
    )
  })

  it('reports the syncing names around the record pass, clearing on failure too', async () => {
    const setSyncing = vi.fn(async () => {})
    const deps = makeDeps([kept('Demo')], {
      setSyncing,
      recordPreview: vi.fn(async () => {
        throw new Error('record failed')
      }),
    })

    await expect(runDevStartupSync({ grep: 'Demo' }, deps)).rejects.toThrow(
      'record failed'
    )
    expect(setSyncing).toHaveBeenNthCalledWith(1, ['Demo'])
    expect(setSyncing).toHaveBeenNthCalledWith(2, [])
  })
})

describe('grepMatcher', () => {
  it('matches everything without a grep', () => {
    expect(grepMatcher(undefined)('anything')).toBe(true)
  })

  it('matches as a regex', () => {
    const matches = grepMatcher('Demo|Other')
    expect(matches('Demo')).toBe(true)
    expect(matches('Third')).toBe(false)
  })

  it('falls back to substring matching on an invalid regex', () => {
    const matches = grepMatcher('a(b')
    expect(matches('the a(b video')).toBe(true)
    expect(matches('nope')).toBe(false)
  })
})
