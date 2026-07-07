/**
 * The `.screenci/action-params.json` snapshot: the latest known action-parameter
 * provenance per video, aggregated by the CLI from the per-recording `data.json`
 * files after every record run. It is never wiped (the record command's
 * directory clear preserves it) so the next run can compare the web editor's
 * overrides against the previous run's explicit code values and warn when an
 * override shadows a value the user set explicitly in code.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import type { ActionOverrides, ActionParamRecord } from './actionParams.js'

/** File name of the snapshot inside `.screenci`. Preserved across runs. */
export const ACTION_PARAMS_SNAPSHOT_FILE = 'action-params.json'

export type ActionParamsSnapshot = {
  version: 1
  videos: Record<string, ActionParamRecord[]>
}

/** An editor override that shadows an explicitly code-set parameter value. */
export type OverrideCollision = {
  videoName: string
  selector: string
  method: string
  occurrence: number
  optionPath: string
  codeValue: unknown
  editorValue: unknown
}

const EMPTY_SNAPSHOT: ActionParamsSnapshot = { version: 1, videos: {} }

/** Read the snapshot; tolerant of a missing or corrupt file (empty snapshot). */
export function readActionParamsSnapshot(
  screenciDir: string
): ActionParamsSnapshot {
  const filePath = join(screenciDir, ACTION_PARAMS_SNAPSHOT_FILE)
  if (!existsSync(filePath)) return { ...EMPTY_SNAPSHOT, videos: {} }
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { videos?: unknown }).videos !== 'object' ||
      (parsed as { videos?: unknown }).videos === null
    ) {
      return { ...EMPTY_SNAPSHOT, videos: {} }
    }
    return {
      version: 1,
      videos: (parsed as ActionParamsSnapshot).videos,
    }
  } catch {
    return { ...EMPTY_SNAPSHOT, videos: {} }
  }
}

/**
 * Collect `actionParams` (keyed by `metadata.videoName`) from every
 * `.screenci/<recording>/data.json` written by the run that just finished.
 * Recordings without action params contribute an empty list (the video ran,
 * and its latest truth is "no tracked actions").
 */
export function collectActionParamsFromRecordings(
  screenciDir: string
): Record<string, ActionParamRecord[]> {
  const collected: Record<string, ActionParamRecord[]> = {}
  if (!existsSync(screenciDir)) return collected
  for (const entry of readdirSync(screenciDir)) {
    const dataPath = join(screenciDir, entry, 'data.json')
    try {
      if (!statSync(join(screenciDir, entry)).isDirectory()) continue
      if (!existsSync(dataPath)) continue
      const parsed: unknown = JSON.parse(readFileSync(dataPath, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) continue
      const data = parsed as {
        metadata?: { videoName?: unknown }
        actionParams?: unknown
      }
      const videoName = data.metadata?.videoName
      if (typeof videoName !== 'string') continue
      const actionParams = Array.isArray(data.actionParams)
        ? (data.actionParams as ActionParamRecord[])
        : []
      // Per-language passes share one videoName; keep the first pass's params
      // (each language performs the same actions).
      if (!(videoName in collected) || actionParams.length > 0) {
        collected[videoName] = actionParams
      }
    } catch {
      continue
    }
  }
  return collected
}

/**
 * Merge freshly recorded params over the existing snapshot. Videos not recorded
 * this run keep their previous entries (a filtered run must not lose them).
 */
export function mergeActionParamsSnapshot(
  existing: ActionParamsSnapshot,
  recorded: Record<string, ActionParamRecord[]>
): ActionParamsSnapshot {
  return {
    version: 1,
    videos: { ...existing.videos, ...recorded },
  }
}

/** Write the snapshot (write-then-rename so a crash never corrupts it). */
export function writeActionParamsSnapshot(
  screenciDir: string,
  snapshot: ActionParamsSnapshot
): void {
  const filePath = join(screenciDir, ACTION_PARAMS_SNAPSHOT_FILE)
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2))
  renameSync(tmpPath, filePath)
}

/**
 * Update the snapshot from the recordings a run just produced: read, merge,
 * write. Called by the CLI after Playwright exits; best-effort by design (the
 * caller catches errors).
 */
export function updateActionParamsSnapshot(screenciDir: string): void {
  const recorded = collectActionParamsFromRecordings(screenciDir)
  if (Object.keys(recorded).length === 0) return
  writeActionParamsSnapshot(
    screenciDir,
    mergeActionParamsSnapshot(readActionParamsSnapshot(screenciDir), recorded)
  )
}

/**
 * Find editor overrides that shadow explicitly code-set values: an override
 * whose key resolves to a snapshot parameter with `source: 'explicit'`. Pure;
 * a missing snapshot (first run) or unknown keys produce no collisions.
 */
export function diffOverridesAgainstSnapshot(
  snapshot: ActionParamsSnapshot,
  overridesByVideo: Record<string, ActionOverrides>
): OverrideCollision[] {
  const collisions: OverrideCollision[] = []
  for (const [videoName, overrides] of Object.entries(overridesByVideo)) {
    const records = snapshot.videos[videoName]
    if (records === undefined) continue
    for (const [key, editorValue] of Object.entries(overrides)) {
      // Key shape: "<selector>|<method>|<occurrence>|<optionPath>". The selector
      // itself may contain pipes only in rare text matchers; parse from the end.
      const parts = key.split('|')
      if (parts.length < 4) continue
      const optionPath = parts[parts.length - 1]!
      const occurrence = Number(parts[parts.length - 2])
      const method = parts[parts.length - 3]!
      const selector = parts.slice(0, parts.length - 3).join('|')
      if (!Number.isInteger(occurrence)) continue
      const record = records.find(
        (r) =>
          r.selector === selector &&
          r.method === method &&
          r.occurrence === occurrence
      )
      const param = record?.params[optionPath]
      if (param === undefined || param.source !== 'explicit') continue
      collisions.push({
        videoName,
        selector,
        method,
        occurrence,
        optionPath,
        codeValue: param.value,
        editorValue,
      })
    }
  }
  return collisions
}
