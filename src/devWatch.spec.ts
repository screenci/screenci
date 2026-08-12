import { describe, expect, it, vi } from 'vitest'
import {
  buildWatchTargets,
  startDevWatcher,
  type DevWatchDeps,
  type WatchTargets,
} from './devWatch.js'
import type { KeptRecording } from './devStartup.js'

const CONFIG = '/proj/screenci.config.ts'

function kept(videoName: string, sourceFilePath?: string): KeptRecording {
  return {
    entry: videoName,
    data: {
      metadata: {
        videoName,
        ...(sourceFilePath !== undefined && { sourceFilePath }),
      },
    } as KeptRecording['data'],
  }
}

describe('buildWatchTargets', () => {
  it('maps source files to the video names they back, grep-filtered', () => {
    const targets = buildWatchTargets(
      [
        kept('Demo', '/proj/demo.screenci.ts'),
        kept('Tour', '/proj/demo.screenci.ts'),
        kept('Other', '/proj/other.screenci.ts'),
        kept('Skipped', '/proj/skipped.screenci.ts'),
        kept('NoSource'),
      ],
      (name) => name !== 'Skipped',
      CONFIG
    )
    expect([...targets.files.keys()]).toEqual([
      '/proj/demo.screenci.ts',
      '/proj/other.screenci.ts',
    ])
    expect([...targets.files.get('/proj/demo.screenci.ts')!]).toEqual([
      'Demo',
      'Tour',
    ])
    expect(targets.configPath).toBe(CONFIG)
  })
})

type Harness = {
  deps: DevWatchDeps
  emit: (dir: string, fileBasename: string) => void
  /** Runs the pending debounce flush and awaits its async work. */
  flush: () => Promise<void>
  hashes: Map<string, string>
  onSourcesChanged: ReturnType<typeof vi.fn>
  onConfigChanged: ReturnType<typeof vi.fn>
  watchedDirs: () => string[]
  cancelledDirs: () => string[]
}

function harness(initialHashes: Record<string, string>): Harness {
  const hashes = new Map(Object.entries(initialHashes))
  const listeners = new Map<string, (fileBasename: string) => void>()
  const cancelled: string[] = []
  let pendingFlush: (() => void) | null = null
  const onSourcesChanged = vi.fn()
  const onConfigChanged = vi.fn()
  const deps: DevWatchDeps = {
    watchDir: (dir, onEvent) => {
      listeners.set(dir, onEvent)
      return () => {
        listeners.delete(dir)
        cancelled.push(dir)
      }
    },
    hashSource: (filePath) => Promise.resolve(hashes.get(filePath)),
    setTimeoutFn: (fn) => {
      pendingFlush = fn
      return () => {
        pendingFlush = null
      }
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    onSourcesChanged,
    onConfigChanged,
  }
  return {
    deps,
    emit: (dir, fileBasename) => listeners.get(dir)?.(fileBasename),
    flush: async () => {
      const run = pendingFlush
      pendingFlush = null
      run?.()
      // The flush hashes asynchronously; let its microtasks settle.
      await new Promise((resolve) => setImmediate(resolve))
    },
    hashes,
    onSourcesChanged,
    onConfigChanged,
    watchedDirs: () => [...listeners.keys()],
    cancelledDirs: () => cancelled,
  }
}

function targetsOf(
  files: Record<string, string[]>,
  configPath: string | null = CONFIG
): WatchTargets {
  return {
    files: new Map(
      Object.entries(files).map(([path, names]) => [path, new Set(names)])
    ),
    configPath,
  }
}

describe('startDevWatcher', () => {
  it('re-records only the videos backed by the changed file', async () => {
    const h = harness({
      '/proj/demo.screenci.ts': 'a1',
      '/proj/other.screenci.ts': 'b1',
      [CONFIG]: 'c1',
    })
    await startDevWatcher(
      targetsOf({
        '/proj/demo.screenci.ts': ['Demo', 'Tour'],
        '/proj/other.screenci.ts': ['Other'],
      }),
      h.deps
    )
    h.hashes.set('/proj/demo.screenci.ts', 'a2')
    h.emit('/proj', 'demo.screenci.ts')
    await h.flush()
    expect(h.onSourcesChanged).toHaveBeenCalledWith(['Demo', 'Tour'])
    expect(h.onConfigChanged).not.toHaveBeenCalled()
  })

  it('ignores a save that does not change the content hash', async () => {
    const h = harness({ '/proj/demo.screenci.ts': 'a1', [CONFIG]: 'c1' })
    await startDevWatcher(
      targetsOf({ '/proj/demo.screenci.ts': ['Demo'] }),
      h.deps
    )
    h.emit('/proj', 'demo.screenci.ts')
    await h.flush()
    expect(h.onSourcesChanged).not.toHaveBeenCalled()
  })

  it('ignores events for files that are not watched', async () => {
    const h = harness({ '/proj/demo.screenci.ts': 'a1', [CONFIG]: 'c1' })
    await startDevWatcher(
      targetsOf({ '/proj/demo.screenci.ts': ['Demo'] }),
      h.deps
    )
    h.emit('/proj', 'unrelated.ts')
    await h.flush()
    expect(h.onSourcesChanged).not.toHaveBeenCalled()
  })

  it('routes a config change to onConfigChanged', async () => {
    const h = harness({ '/proj/demo.screenci.ts': 'a1', [CONFIG]: 'c1' })
    await startDevWatcher(
      targetsOf({ '/proj/demo.screenci.ts': ['Demo'] }),
      h.deps
    )
    h.hashes.set(CONFIG, 'c2')
    h.emit('/proj', 'screenci.config.ts')
    await h.flush()
    expect(h.onConfigChanged).toHaveBeenCalledTimes(1)
    expect(h.onSourcesChanged).not.toHaveBeenCalled()
  })

  it('debounces a burst of events into one coalesced flush', async () => {
    const h = harness({
      '/proj/demo.screenci.ts': 'a1',
      '/proj/other.screenci.ts': 'b1',
      [CONFIG]: 'c1',
    })
    await startDevWatcher(
      targetsOf({
        '/proj/demo.screenci.ts': ['Demo'],
        '/proj/other.screenci.ts': ['Other'],
      }),
      h.deps
    )
    h.hashes.set('/proj/demo.screenci.ts', 'a2')
    h.hashes.set('/proj/other.screenci.ts', 'b2')
    h.emit('/proj', 'demo.screenci.ts')
    h.emit('/proj', 'demo.screenci.ts')
    h.emit('/proj', 'other.screenci.ts')
    await h.flush()
    expect(h.onSourcesChanged).toHaveBeenCalledTimes(1)
    expect(h.onSourcesChanged).toHaveBeenCalledWith(['Demo', 'Other'])
  })

  it("suppresses the CLI's own write after refreshBaseline", async () => {
    const h = harness({ '/proj/demo.screenci.ts': 'a1', [CONFIG]: 'c1' })
    const watcher = await startDevWatcher(
      targetsOf({ '/proj/demo.screenci.ts': ['Demo'] }),
      h.deps
    )
    // Codegen writes the file, then re-baselines before the event flushes.
    h.hashes.set('/proj/demo.screenci.ts', 'a2')
    await watcher.refreshBaseline('/proj/demo.screenci.ts')
    h.emit('/proj', 'demo.screenci.ts')
    await h.flush()
    expect(h.onSourcesChanged).not.toHaveBeenCalled()
    // A real edit afterwards still fires.
    h.hashes.set('/proj/demo.screenci.ts', 'a3')
    h.emit('/proj', 'demo.screenci.ts')
    await h.flush()
    expect(h.onSourcesChanged).toHaveBeenCalledWith(['Demo'])
  })

  it('refreshTargets adds and removes directory watchers', async () => {
    const h = harness({
      '/proj/demo.screenci.ts': 'a1',
      '/elsewhere/new.screenci.ts': 'n1',
      [CONFIG]: 'c1',
    })
    const watcher = await startDevWatcher(
      targetsOf({ '/proj/demo.screenci.ts': ['Demo'] }),
      h.deps
    )
    expect(h.watchedDirs()).toEqual(['/proj'])
    await watcher.refreshTargets(
      targetsOf({ '/elsewhere/new.screenci.ts': ['New'] })
    )
    expect(h.watchedDirs().sort()).toEqual(['/elsewhere', '/proj'])
    h.hashes.set('/elsewhere/new.screenci.ts', 'n2')
    h.emit('/elsewhere', 'new.screenci.ts')
    await h.flush()
    expect(h.onSourcesChanged).toHaveBeenCalledWith(['New'])
  })

  it('stop cancels watchers and the pending flush', async () => {
    const h = harness({ '/proj/demo.screenci.ts': 'a1', [CONFIG]: 'c1' })
    const watcher = await startDevWatcher(
      targetsOf({ '/proj/demo.screenci.ts': ['Demo'] }),
      h.deps
    )
    h.hashes.set('/proj/demo.screenci.ts', 'a2')
    h.emit('/proj', 'demo.screenci.ts')
    watcher.stop()
    await h.flush()
    expect(h.onSourcesChanged).not.toHaveBeenCalled()
    expect(h.cancelledDirs()).toContain('/proj')
  })

  it('works without a config path', async () => {
    const h = harness({ '/proj/demo.screenci.ts': 'a1' })
    await startDevWatcher(
      targetsOf({ '/proj/demo.screenci.ts': ['Demo'] }, null),
      h.deps
    )
    h.hashes.set('/proj/demo.screenci.ts', 'a2')
    h.emit('/proj', 'demo.screenci.ts')
    await h.flush()
    expect(h.onSourcesChanged).toHaveBeenCalledWith(['Demo'])
  })
})
