/**
 * `screenci dev` startup handshake.
 *
 * Before the poll loop starts serving the editor, every video this session
 * manages must be up to date: its kept recording data (data.json preserved
 * across uploads) must match the current test source (sourceHash) and every
 * editable action must carry an editId, so editor edits can always be
 * codegen'd by id. Videos failing the check get their missing editIds
 * stamped into the source and are re-recorded as a preview (no render).
 *
 * A brand-new project has no kept data at all: the first pass records
 * everything, the second stamps the freshly learned editIds and re-records,
 * a third verifies. Anything still unstampable afterwards (loop call sites)
 * is reported and left web-runtime-only.
 */
import type { EditableSnapshotEntry } from './editableSnapshot.js'
import type { RecordingData } from './recordingData.js'
import { hashSourceFile, isRecordingFresh } from './recordingFreshness.js'
import type { DevListenLogger } from './devListen.js'

export type KeptRecording = {
  /** Recording directory name, for logging. */
  entry: string
  data: RecordingData
}

export type DevStartupDeps = {
  /** Reads every kept recording's data (data.json or last-data.json). */
  readKeptRecordings: () => Promise<KeptRecording[]>
  /** Hashes a test source file; undefined when unreadable. */
  hashSource?: (filePath: string) => Promise<string | undefined>
  /**
   * Stamps missing editIds into the sources for the given videos' entries.
   * Returns the number of stamps written.
   */
  stampEditIds: (
    videos: Record<string, EditableSnapshotEntry[]>
  ) => Promise<number>
  /**
   * Re-stamps editId collisions (one slug at two distinct call sites) across
   * the given source files with fresh slugs. Returns the number of renames.
   * A rewrite changes the source, so the affected videos re-record on the next
   * pass via the freshness check. Optional; a no-op when unwired.
   */
  resolveDuplicateEditIds?: (sourcePaths: string[]) => Promise<number>
  /**
   * Records the videos matching the grep pattern (or all when undefined) as
   * a preview (uploaded to the preview slot, no render) and uploads them.
   */
  recordPreview: (grepPattern: string | undefined) => Promise<void>
  /** Extracts the per-video editable entries from kept recording data. */
  entriesFromData: (data: RecordingData) => EditableSnapshotEntry[]
  /**
   * Reports the videos currently being brought up to date (the editor locks
   * their timelines). Called with the stale names before each record pass and
   * with [] once the handshake finishes. Best-effort.
   */
  setSyncing?: (videoNames: string[]) => Promise<void>
  logger: DevListenLogger
}

export type DevStartupOptions = {
  /** Only manage videos whose name matches this pattern (regex, like --grep). */
  grep?: string
  /** Re-record everything regardless of freshness. */
  forceRecord?: boolean
}

export type DevStartupResult = {
  /** Videos re-recorded during the handshake. */
  recorded: string[]
  /** Videos whose kept recording was fresh (recording skipped). */
  fresh: string[]
  /** Videos still missing editIds after the handshake (loop call sites). */
  missingEditIds: string[]
}

/** Matcher for `--grep`-style filters; shared with the source-file watcher. */
export function grepMatcher(
  grep: string | undefined
): (name: string) => boolean {
  if (grep === undefined) return () => true
  try {
    const regex = new RegExp(grep)
    return (name) => regex.test(name)
  } catch {
    return (name) => name.includes(grep)
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

type VideoState = {
  videoName: string
  entries: EditableSnapshotEntry[]
  fresh: boolean
  missingIds: boolean
}

async function collectStates(
  deps: DevStartupDeps,
  matches: (name: string) => boolean
): Promise<VideoState[]> {
  const hashSource = deps.hashSource ?? hashSourceFile
  const states = new Map<string, VideoState>()
  for (const kept of await deps.readKeptRecordings()) {
    const videoName = kept.data.metadata?.videoName
    if (videoName === undefined || !matches(videoName)) continue
    // Per-language recordings share a videoName; one pass's data suffices.
    if (states.has(videoName)) continue
    const sourceFile = kept.data.metadata?.sourceFilePath
    const currentHash =
      sourceFile !== undefined ? await hashSource(sourceFile) : undefined
    const entries = deps.entriesFromData(kept.data)
    states.set(videoName, {
      videoName,
      entries,
      fresh: isRecordingFresh(kept.data, currentHash),
      missingIds: entries.some((entry) => entry.editId === undefined),
    })
  }
  return [...states.values()]
}

export async function runDevStartupSync(
  options: DevStartupOptions,
  deps: DevStartupDeps
): Promise<DevStartupResult> {
  const matches = grepMatcher(options.grep)
  const recorded = new Set<string>()
  let fresh: string[] = []
  let missingEditIds: string[] = []

  // Worst case (brand-new project): pass 1 records everything to learn the
  // actions, pass 2 stamps the editIds and re-records, pass 3 verifies.
  const MAX_PASSES = 3
  for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    let states = await collectStates(deps, matches)

    // No kept data yet: nothing is known about the videos, record everything
    // this session manages and learn from the produced data.json files.
    if (states.length === 0) {
      if (pass === MAX_PASSES) break
      deps.logger.info(
        'No kept recordings found, recording to initialize the dev session...'
      )
      await deps.recordPreview(options.grep)
      continue
    }

    // Resolve duplicate editIds (one slug at two distinct call sites) before
    // anything else: the rewrite changes the source, so re-collect freshness so
    // the affected videos re-record this pass.
    if (deps.resolveDuplicateEditIds) {
      const sourcePaths = [
        ...new Set(
          states
            .flatMap((state) => state.entries)
            .map((entry) => entry.source?.file)
            .filter((file): file is string => file !== undefined)
        ),
      ]
      const fixed = await deps.resolveDuplicateEditIds(sourcePaths)
      if (fixed > 0) {
        deps.logger.info(
          `Resolved ${fixed} duplicate editId${fixed === 1 ? '' : 's'} into the sources.`
        )
        states = await collectStates(deps, matches)
      }
    }

    // Stamp missing editIds first so the (re-)record's data.json carries them.
    const missing = states.filter((state) => state.missingIds)
    if (missing.length > 0) {
      const stamps = await deps.stampEditIds(
        Object.fromEntries(
          missing.map((state) => [state.videoName, state.entries])
        )
      )
      if (stamps > 0) {
        deps.logger.info(
          `Stamped ${stamps} missing editId${stamps === 1 ? '' : 's'} into the sources.`
        )
      }
    }

    const force = options.forceRecord === true && pass === 1
    const stale = states.filter(
      (state) => force || !state.fresh || state.missingIds
    )
    fresh = states
      .filter((state) => !stale.includes(state))
      .map((state) => state.videoName)
    missingEditIds = missing.map((state) => state.videoName)

    if (stale.length === 0) break
    if (pass === MAX_PASSES) {
      // The second pass's stale set means stamping could not fix everything
      // (e.g. loop call sites): record once more would not converge.
      break
    }

    const names = stale.map((state) => state.videoName)
    deps.logger.info(
      `Recording ${names.length} out-of-date video${names.length === 1 ? '' : 's'}: ${names.join(', ')}`
    )
    if (deps.setSyncing) await deps.setSyncing(names).catch(() => {})
    try {
      await deps.recordPreview(
        names.map((name) => escapeRegExp(name)).join('|')
      )
    } finally {
      if (deps.setSyncing) await deps.setSyncing([]).catch(() => {})
    }
    for (const name of names) recorded.add(name)
  }

  if (missingEditIds.length > 0) {
    deps.logger.warn(
      `Some actions still have no editId (loop call sites cannot be stamped): ${missingEditIds.join(', ')}. Their timings stay web-editable only.`
    )
  }
  if (recorded.size === 0 && fresh.length > 0) {
    deps.logger.info(
      'All recordings are up to date with the test sources, skipping record.'
    )
  }

  return { recorded: [...recorded], fresh, missingEditIds }
}
