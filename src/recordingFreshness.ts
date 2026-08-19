import { createHash } from 'crypto'
import { existsSync, readdirSync, statSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { join, resolve } from 'path'

import type { RecordingData, RecordingEvent } from './recordingData.js'
import type { EditableMeta } from './editableDescriptor.js'

/**
 * Freshness check for kept recordings.
 *
 * `data.json` survives uploads (only the media files are cleaned up) so the
 * next `screenci edit` session can decide whether a recording needs to be
 * re-recorded at all. A recording is fresh when the test source it came from
 * is byte-identical (same `sourceHash`) AND every editable action in it is
 * addressable by an `editId`. Anything less means the code changed or some
 * action still needs an editId stamped, so a (preview) record run is required
 * before the editor may edit the timeline.
 */

/**
 * Name of a previous run's kept event data inside a recording directory.
 * `clearRecordingDirectories` renames `data.json` to this at run start so the
 * upload phase never mistakes a kept recording for a freshly recorded one.
 */
export const LAST_DATA_FILE = 'last-data.json'

/**
 * Reads the kept recording data of a recording directory: this run's
 * `data.json` when present, otherwise a previous run's `last-data.json`.
 * Resolves to null when neither exists or parsing fails.
 */
export async function readKeptRecordingData(
  recordingDir: string,
  readFileFn: ReadFileFn = (p) => readFile(p)
): Promise<RecordingData | null> {
  for (const name of ['data.json', LAST_DATA_FILE]) {
    try {
      const raw = await readFileFn(join(recordingDir, name))
      return JSON.parse(raw.toString()) as RecordingData
    } catch {
      // Missing or unparsable: try the next candidate.
    }
  }
  return null
}

/** SHA-256 hex digest of the given source file content. */
export function computeSourceHash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

export type ReadFileFn = (path: string) => Promise<Buffer>

/**
 * Hashes a test source file on disk. Resolves to undefined when the file
 * cannot be read (missing file: the recording can never be fresh).
 */
export async function hashSourceFile(
  filePath: string,
  readFileFn: ReadFileFn = (p) => readFile(p)
): Promise<string | undefined> {
  try {
    return computeSourceHash(await readFileFn(filePath))
  } catch {
    return undefined
  }
}

function eventEditable(event: RecordingEvent): EditableMeta | undefined {
  return (event as { editable?: EditableMeta }).editable
}

/**
 * True when every editable event and every recorded action parameter carries
 * an editId. Events without editable metadata (sleeps, cue ends, ...) do not
 * need one.
 */
export function allEventsHaveEditIds(data: RecordingData): boolean {
  for (const event of data.events) {
    const editable = eventEditable(event)
    if (editable !== undefined && editable.descriptor.editId === undefined) {
      return false
    }
  }
  for (const record of data.actionParams ?? []) {
    if (record.editId === undefined) return false
  }
  return true
}

/**
 * A kept recording is fresh (recording can be skipped) when its stored source
 * hash matches the current test file's hash and every editable action already
 * has an editId. `currentSourceHash` is undefined when the source file could
 * not be read; that is never fresh.
 */
export function isRecordingFresh(
  data: RecordingData,
  currentSourceHash: string | undefined
): boolean {
  const storedHash = data.metadata?.sourceHash
  if (storedHash === undefined || currentSourceHash === undefined) return false
  if (storedHash !== currentSourceHash) return false
  return allEventsHaveEditIds(data)
}

export type RebaselineDeps = {
  /** Lists recording directories under the `.screenci` directory. */
  listRecordingDirs: (screenciDir: string) => string[]
  readFileFn: ReadFileFn
  writeFileFn: (path: string, content: string) => Promise<void>
}

function defaultListRecordingDirs(screenciDir: string): string[] {
  if (!existsSync(screenciDir)) return []
  return readdirSync(screenciDir)
    .map((entry) => resolve(screenciDir, entry))
    .filter(
      (dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true
    )
}

/**
 * Re-baselines kept recordings after the CLI itself rewrote their test
 * sources for an edit that applies at render time (`requiresRecord: false`):
 * the recorded footage is still valid for the new source bytes, so the stored
 * `metadata.sourceHash` is updated to the current file hash and the recording
 * stays fresh (no re-record on the next preview or export).
 *
 * Every recording directory is visited (per-language recordings share a video
 * name but each keeps its own data file). A directory is re-baselined when
 * its `sourceFilePath` matches one of `changedSourcePaths`; matching by
 * source path re-baselines every video declared in a rewritten multi-video
 * file. The same file that was read (`data.json` or `last-data.json`) is
 * rewritten. Best-effort: unreadable or unparsable files are skipped and a
 * write failure never throws.
 *
 * Returns the video names that were re-baselined.
 */
export async function rebaselineKeptSourceHashes(
  params: {
    screenciDir: string
    changedSourcePaths: readonly string[]
  },
  deps?: Partial<RebaselineDeps>
): Promise<string[]> {
  const listRecordingDirs = deps?.listRecordingDirs ?? defaultListRecordingDirs
  const readFileFn = deps?.readFileFn ?? ((p: string) => readFile(p))
  const writeFileFn =
    deps?.writeFileFn ??
    (async (p: string, content: string) => {
      await writeFile(p, content)
    })

  const changed = new Set(params.changedSourcePaths.map((p) => resolve(p)))
  const rebaselined: string[] = []
  for (const dir of listRecordingDirs(params.screenciDir)) {
    for (const name of ['data.json', LAST_DATA_FILE]) {
      const filePath = join(dir, name)
      let data: RecordingData
      try {
        data = JSON.parse(
          (await readFileFn(filePath)).toString()
        ) as RecordingData
      } catch {
        // Missing or unparsable: try the next candidate file.
        continue
      }
      const sourceFilePath = data.metadata?.sourceFilePath
      if (
        sourceFilePath !== undefined &&
        changed.has(resolve(sourceFilePath))
      ) {
        const currentHash = await hashSourceFile(sourceFilePath, readFileFn)
        if (
          currentHash !== undefined &&
          data.metadata !== undefined &&
          data.metadata.sourceHash !== currentHash
        ) {
          data.metadata.sourceHash = currentHash
          try {
            await writeFileFn(filePath, JSON.stringify(data, null, 2))
            const videoName = data.metadata.videoName
            if (videoName !== undefined && !rebaselined.includes(videoName)) {
              rebaselined.push(videoName)
            }
          } catch {
            // Best-effort: a failed rewrite only means the recording stays
            // stale and re-records later; never fail the apply.
          }
        }
      }
      // Only the first readable data file per directory counts, mirroring
      // readKeptRecordingData's data.json-then-last-data.json fallback.
      break
    }
  }
  return rebaselined
}
