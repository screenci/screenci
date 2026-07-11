/**
 * Source-file watcher behind `screenci dev`: watches the test sources backing
 * the session's managed videos (plus screenci.config.ts) and raises a
 * machine-local preview re-record when one of them changes.
 *
 * The video-to-source map reuses the same recording metadata the startup
 * handshake reads (`sourceFilePath` per kept recording, `--grep` filtering).
 * Watching is directory-level (non-recursive) and filtered by basename, so
 * editor atomic saves (write temp file, rename over the original) are seen as
 * plain changes. Every flush re-hashes the changed files and compares against
 * a per-file baseline: a save that does not change the content (or the CLI's
 * own codegen write, whose baseline is refreshed by the caller) triggers
 * nothing.
 *
 * All side effects (directory watching, hashing, timers) are injected so the
 * decision logic is unit-testable without a real file system.
 */
import { dirname, join } from 'path'
import { watch } from 'fs'
import { hashSourceFile } from './recordingFreshness.js'
import type { DevListenLogger } from './devListen.js'
import type { KeptRecording } from './devStartup.js'

export const DEV_WATCH_DEBOUNCE_MS = 300

/** The files to watch: absolute source path to the video names it backs. */
export type WatchTargets = {
  files: Map<string, Set<string>>
  /** The resolved screenci.config.ts path; changes re-record everything. */
  configPath: string | null
}

/**
 * Builds the watch targets from kept recording data: every managed
 * (grep-matched) video's `sourceFilePath`, plus the config file.
 */
export function buildWatchTargets(
  recordings: KeptRecording[],
  matches: (videoName: string) => boolean,
  configPath: string | null
): WatchTargets {
  const files = new Map<string, Set<string>>()
  for (const kept of recordings) {
    const videoName = kept.data.metadata?.videoName
    const sourceFile = kept.data.metadata?.sourceFilePath
    if (videoName === undefined || sourceFile === undefined) continue
    if (!matches(videoName)) continue
    const names = files.get(sourceFile) ?? new Set<string>()
    names.add(videoName)
    files.set(sourceFile, names)
  }
  return { files, configPath }
}

export type DevWatchDeps = {
  /**
   * Watches a directory (non-recursive) and reports the basename of each
   * changed entry. Returns a cancel function. Defaults to `fs.watch`.
   */
  watchDir?: (
    dir: string,
    onEvent: (fileBasename: string) => void
  ) => () => void
  /** Hashes a source file; undefined when unreadable. Defaults to SHA-256. */
  hashSource?: (filePath: string) => Promise<string | undefined>
  /** Debounce timer, injectable for tests. Returns a cancel function. */
  setTimeoutFn?: (fn: () => void, ms: number) => () => void
  debounceMs?: number
  logger: DevListenLogger
  /** Called with the video names affected by changed source files. */
  onSourcesChanged: (videoNames: string[]) => void
  /** Called when the config file changed. */
  onConfigChanged: () => void
}

export type DevWatcherController = {
  stop: () => void
  /** Replaces the watched file set (after a record learned new sources). */
  refreshTargets: (targets: WatchTargets) => Promise<void>
  /**
   * Re-baselines one file after the CLI's own write (codegen, editId stamps)
   * so the watcher does not re-record on its own output.
   */
  refreshBaseline: (filePath: string) => Promise<void>
}

function defaultWatchDir(
  dir: string,
  onEvent: (fileBasename: string) => void
): () => void {
  // `rename` and `change` are treated identically: atomic saves surface as
  // renames. Errors (deleted directory, network FS) stop that watcher only.
  const watcher = watch(dir, (_eventType, fileName) => {
    if (typeof fileName === 'string' && fileName.length > 0) {
      onEvent(fileName)
    }
  })
  watcher.on('error', () => {
    watcher.close()
  })
  return () => watcher.close()
}

function defaultSetTimeout(fn: () => void, ms: number): () => void {
  const handle = setTimeout(fn, ms)
  return () => clearTimeout(handle)
}

/**
 * Starts watching the given targets. Watches each parent directory once,
 * filters events by the watched basenames, debounces, then re-hashes each
 * candidate file and reports only real content changes.
 */
export async function startDevWatcher(
  targets: WatchTargets,
  deps: DevWatchDeps
): Promise<DevWatcherController> {
  const watchDir = deps.watchDir ?? defaultWatchDir
  const hashSource = deps.hashSource ?? hashSourceFile
  const setTimeoutFn = deps.setTimeoutFn ?? defaultSetTimeout
  const debounceMs = deps.debounceMs ?? DEV_WATCH_DEBOUNCE_MS

  let current: WatchTargets = targets
  let stopped = false
  const baselines = new Map<string, string | undefined>()
  const dirWatchers = new Map<string, () => void>()
  const pending = new Set<string>()
  let cancelFlush: (() => void) | null = null

  const watchedPaths = (): string[] => [
    ...current.files.keys(),
    ...(current.configPath !== null ? [current.configPath] : []),
  ]

  const flush = async (): Promise<void> => {
    cancelFlush = null
    const changed = [...pending]
    pending.clear()
    const videoNames = new Set<string>()
    let configChanged = false
    for (const filePath of changed) {
      const hash = await hashSource(filePath)
      if (hash === baselines.get(filePath)) continue // no-op save
      baselines.set(filePath, hash)
      if (filePath === current.configPath) {
        configChanged = true
        continue
      }
      for (const name of current.files.get(filePath) ?? []) {
        videoNames.add(name)
      }
    }
    if (stopped) return
    if (configChanged) {
      deps.onConfigChanged()
      return
    }
    if (videoNames.size > 0) {
      deps.onSourcesChanged([...videoNames])
    }
  }

  const onDirEvent = (dir: string, fileBasename: string): void => {
    if (stopped) return
    const filePath = join(dir, fileBasename)
    if (!watchedPaths().includes(filePath)) return
    pending.add(filePath)
    cancelFlush?.()
    cancelFlush = setTimeoutFn(() => {
      void flush()
    }, debounceMs)
  }

  const syncDirWatchers = (): void => {
    const wantedDirs = new Set(watchedPaths().map((path) => dirname(path)))
    for (const [dir, cancel] of dirWatchers) {
      if (!wantedDirs.has(dir)) {
        cancel()
        dirWatchers.delete(dir)
      }
    }
    for (const dir of wantedDirs) {
      if (dirWatchers.has(dir)) continue
      try {
        dirWatchers.set(
          dir,
          watchDir(dir, (fileBasename) => onDirEvent(dir, fileBasename))
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        deps.logger.warn(`Cannot watch ${dir}: ${message}`)
      }
    }
  }

  const captureBaselines = async (): Promise<void> => {
    for (const filePath of watchedPaths()) {
      if (!baselines.has(filePath)) {
        baselines.set(filePath, await hashSource(filePath))
      }
    }
  }

  syncDirWatchers()
  await captureBaselines()

  return {
    stop: () => {
      stopped = true
      cancelFlush?.()
      cancelFlush = null
      for (const cancel of dirWatchers.values()) cancel()
      dirWatchers.clear()
    },
    refreshTargets: async (next) => {
      current = next
      syncDirWatchers()
      await captureBaselines()
    },
    refreshBaseline: async (filePath) => {
      baselines.set(filePath, await hashSource(filePath))
      pending.delete(filePath)
    },
  }
}
