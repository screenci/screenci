import { describe, expect, it, vi } from 'vitest'

import {
  runDevStartupSync,
  type DevStartupDeps,
  type KeptRecording,
} from './devStartup.js'
import type { EditableSnapshotEntry } from './editableSnapshot.js'
import type { RecordingData } from './recordingData.js'

function entry(editId?: string): EditableSnapshotEntry {
  return {
    key: editId ?? 'delay|||0',
    ...(editId !== undefined && { editId }),
    locked: false,
    defaults: { durationMs: 100 },
    source: { file: '/proj/demo.screenci.ts', line: 3 },
  }
}

function kept(
  videoName: string,
  sourceHash: string | undefined,
  entries: EditableSnapshotEntry[]
): KeptRecording & { entries: EditableSnapshotEntry[] } {
  return {
    entry: `${videoName} [en]`,
    entries,
    data: {
      events: [],
      renderOptions: {} as RecordingData['renderOptions'],
      metadata: {
        videoName,
        screenciVersion: '0.0.0',
        sourceFilePath: '/proj/demo.screenci.ts',
        ...(sourceHash !== undefined && { sourceHash }),
      },
    },
  }
}

function makeDeps(
  recordings: Array<KeptRecording & { entries: EditableSnapshotEntry[] }>,
  overrides: Partial<DevStartupDeps> = {}
): DevStartupDeps & {
  stampEditIds: ReturnType<typeof vi.fn>
  recordPreview: ReturnType<typeof vi.fn>
} {
  const byVideo = new Map(
    recordings.map((r) => [r.data.metadata?.videoName, r])
  )
  const stampEditIds = vi.fn(async () => 0)
  const recordPreview = vi.fn(async () => {})
  return {
    readKeptRecordings: async () => recordings,
    hashSource: async () => 'hash-a',
    stampEditIds,
    recordPreview,
    entriesFromData: (data) =>
      byVideo.get(data.metadata?.videoName)?.entries ?? [],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  }
}

describe('runDevStartupSync', () => {
  it('skips recording when everything is fresh and stamped', async () => {
    const deps = makeDeps([kept('Demo', 'hash-a', [entry('delay1')])])

    const result = await runDevStartupSync({}, deps)

    expect(deps.recordPreview).not.toHaveBeenCalled()
    expect(result.fresh).toEqual(['Demo'])
    expect(result.recorded).toEqual([])
  })

  it('re-records a video whose source hash changed', async () => {
    const deps = makeDeps([kept('Demo', 'old-hash', [entry('delay1')])])

    const result = await runDevStartupSync({}, deps)

    expect(deps.recordPreview).toHaveBeenCalledWith('Demo')
    expect(result.recorded).toEqual(['Demo'])
  })

  it('stamps missing editIds before re-recording', async () => {
    const calls: string[] = []
    const deps = makeDeps([kept('Demo', 'hash-a', [entry()])], {})
    deps.stampEditIds.mockImplementation(async () => {
      calls.push('stamp')
      return 1
    })
    deps.recordPreview.mockImplementation(async () => {
      calls.push('record')
    })

    await runDevStartupSync({}, deps)

    expect(calls[0]).toBe('stamp')
    expect(calls).toContain('record')
    expect(deps.stampEditIds).toHaveBeenCalledWith({
      Demo: [entry()],
    })
  })

  it('records everything first when no kept data exists', async () => {
    const deps = makeDeps([])

    await runDevStartupSync({ grep: 'Intro' }, deps)

    expect(deps.recordPreview).toHaveBeenCalledWith('Intro')
  })

  it('escapes video names in the re-record grep pattern', async () => {
    const deps = makeDeps([kept('My Video (v2)', 'stale', [entry('a1')])])

    await runDevStartupSync({}, deps)

    expect(deps.recordPreview).toHaveBeenCalledWith('My Video \\(v2\\)')
  })

  it('force-records fresh videos when forceRecord is set', async () => {
    const deps = makeDeps([kept('Demo', 'hash-a', [entry('delay1')])])

    const result = await runDevStartupSync({ forceRecord: true }, deps)

    expect(deps.recordPreview).toHaveBeenCalledWith('Demo')
    expect(result.recorded).toEqual(['Demo'])
  })

  it('filters managed videos by grep', async () => {
    const deps = makeDeps([
      kept('Intro', 'stale', [entry('a1')]),
      kept('Outro', 'stale', [entry('b1')]),
    ])

    const result = await runDevStartupSync({ grep: 'Intro' }, deps)

    expect(deps.recordPreview).toHaveBeenCalledWith('Intro')
    expect(result.recorded).toEqual(['Intro'])
  })

  it('reports syncing video names around the record pass and clears them', async () => {
    const calls: string[][] = []
    const recording = kept('Demo', 'stale', [entry('a1')])
    const deps = makeDeps([recording], {
      setSyncing: async (names) => {
        calls.push(names)
      },
    })
    // The record pass writes a fresh data.json whose hash matches the source.
    deps.recordPreview.mockImplementation(async () => {
      recording.data.metadata!.sourceHash = 'hash-a'
    })

    await runDevStartupSync({}, deps)

    expect(calls).toEqual([['Demo'], []])
  })

  it('clears the syncing state even when the record pass fails', async () => {
    const calls: string[][] = []
    const deps = makeDeps([kept('Demo', 'stale', [entry('a1')])], {
      setSyncing: async (names) => {
        calls.push(names)
      },
    })
    deps.recordPreview.mockRejectedValue(new Error('record failed'))

    await expect(runDevStartupSync({}, deps)).rejects.toThrow('record failed')
    expect(calls).toEqual([['Demo'], []])
  })

  it('warns about videos whose editIds cannot be stamped (loops)', async () => {
    // stampEditIds returns 0: nothing could be stamped, entries stay id-less.
    const deps = makeDeps([kept('Demo', 'hash-a', [entry()])])

    const result = await runDevStartupSync({}, deps)

    expect(result.missingEditIds).toEqual(['Demo'])
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Demo')
    )
  })
})
