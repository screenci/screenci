/**
 * Comparison of the web editor's action-parameter overrides against the latest
 * local recording snapshot (`.screenci/action-params.json`), powering
 * `screenci status` (human report) and `screenci sync-prompt` (an agent-ready
 * prompt that brings code back in sync with the editor). Pure; the CLI wires
 * in the fetched overrides and the snapshot.
 */
import {
  ACTION_PARAM_DEFAULTS,
  jsonEqual,
  type ActionMethod,
  type ActionOverrides,
  type ActionOverridesByVideo,
} from './actionParams.js'
import type { ActionParamsSnapshot } from './actionParamsSnapshot.js'

/**
 * How one editor override relates to the code as of the latest recording:
 *
 * - `change`: overrides an explicitly code-set value; code should change it.
 * - `remove`: resets an explicitly code-set value back to the default; code
 *   should drop the explicit option.
 * - `codify`: overrides a defaulted value; code may set it explicitly.
 * - `in-sync`: the override equals the code value (nothing to do).
 * - `stale`: the override's action does not exist in the latest snapshot
 *   (selector/method/occurrence mismatch); the code changed since the edit.
 */
export type OverrideKind = 'change' | 'remove' | 'codify' | 'in-sync' | 'stale'

export type OverrideAssessment = {
  kind: OverrideKind
  selector: string
  method: string
  occurrence: number
  optionPath: string
  editorValue: unknown
  /** The code value from the snapshot (absent for `stale`). */
  codeValue?: unknown
  /** The SDK default for this method+option, when known. */
  defaultValue?: unknown
}

export type VideoComparison = {
  videoName: string
  /** False when the latest snapshot has no recording of this video. */
  inSnapshot: boolean
  overrides: OverrideAssessment[]
}

export type WebStateComparison = {
  videos: VideoComparison[]
  /** True when no snapshot exists yet (no recorded run to compare against). */
  snapshotEmpty: boolean
}

/** Parse `"<selector>|<method>|<occurrence>|<optionPath>"` (selector may contain pipes). */
function parseParamKey(key: string): {
  selector: string
  method: string
  occurrence: number
  optionPath: string
} | null {
  const parts = key.split('|')
  if (parts.length < 4) return null
  const optionPath = parts[parts.length - 1]!
  const occurrence = Number(parts[parts.length - 2])
  const method = parts[parts.length - 3]!
  const selector = parts.slice(0, parts.length - 3).join('|')
  if (!Number.isInteger(occurrence)) return null
  return { selector, method, occurrence, optionPath }
}

function assessOverrides(
  records: ActionParamsSnapshot['videos'][string] | undefined,
  overrides: ActionOverrides
): OverrideAssessment[] {
  const assessments: OverrideAssessment[] = []
  for (const [key, editorValue] of Object.entries(overrides)) {
    const parsed = parseParamKey(key)
    if (parsed === null) continue
    const base = { ...parsed, editorValue }
    const defaultValue =
      ACTION_PARAM_DEFAULTS[parsed.method as ActionMethod]?.[parsed.optionPath]
    const withDefault =
      defaultValue !== undefined ? { ...base, defaultValue } : base

    const record = records?.find(
      (r) =>
        r.selector === parsed.selector &&
        r.method === parsed.method &&
        r.occurrence === parsed.occurrence
    )
    const param = record?.params[parsed.optionPath]
    if (param === undefined) {
      assessments.push({ kind: 'stale', ...withDefault })
      continue
    }

    const codeValue = param.value
    if (jsonEqual(editorValue, codeValue)) {
      assessments.push({ kind: 'in-sync', ...withDefault, codeValue })
    } else if (param.source === 'default') {
      assessments.push({ kind: 'codify', ...withDefault, codeValue })
    } else if (
      defaultValue !== undefined &&
      jsonEqual(editorValue, defaultValue)
    ) {
      assessments.push({ kind: 'remove', ...withDefault, codeValue })
    } else {
      assessments.push({ kind: 'change', ...withDefault, codeValue })
    }
  }
  return assessments
}

/**
 * Compare every video's editor overrides against the latest snapshot.
 * `grep` filters video names (same semantics as Playwright's `--grep`: a
 * regular expression tested against the name).
 */
export function compareWebStateToSnapshot(
  snapshot: ActionParamsSnapshot,
  overridesByVideo: ActionOverridesByVideo,
  grep?: RegExp
): WebStateComparison {
  const videos: VideoComparison[] = []
  for (const [videoName, overrides] of Object.entries(overridesByVideo)) {
    if (grep !== undefined && !grep.test(videoName)) continue
    const records = snapshot.videos[videoName]
    videos.push({
      videoName,
      inSnapshot: records !== undefined,
      overrides: assessOverrides(records, overrides),
    })
  }
  return {
    videos,
    snapshotEmpty: Object.keys(snapshot.videos).length === 0,
  }
}

function formatValue(value: unknown): string {
  return JSON.stringify(value)
}

/** Human-readable `screenci status` report lines. */
export function formatStatusReport(comparison: WebStateComparison): string[] {
  const lines: string[] = []
  if (comparison.snapshotEmpty) {
    lines.push(
      'No local recording snapshot yet: run `screenci record` once to compare.'
    )
  }
  const totalOverrides = comparison.videos.reduce(
    (sum, video) => sum + video.overrides.length,
    0
  )
  if (totalOverrides === 0) {
    lines.push('Editor overrides: none. Code and web editor are in sync.')
    return lines
  }
  for (const video of comparison.videos) {
    if (video.overrides.length === 0) continue
    lines.push(`Video: ${video.videoName}`)
    if (!video.inSnapshot) {
      lines.push(
        '  (not in the latest local snapshot: record it to compare precisely)'
      )
    }
    for (const o of video.overrides) {
      const where = `${o.selector} ${o.method}#${o.occurrence} ${o.optionPath}`
      switch (o.kind) {
        case 'change':
          lines.push(
            `  override shadows explicit code value: ${where}: ` +
              `code ${formatValue(o.codeValue)} -> editor ${formatValue(o.editorValue)}`
          )
          break
        case 'remove':
          lines.push(
            `  override resets explicit code value to the default: ${where}: ` +
              `code ${formatValue(o.codeValue)} -> default ${formatValue(o.defaultValue)}`
          )
          break
        case 'codify':
          lines.push(
            `  override changes a defaulted value: ${where}: ` +
              `default ${formatValue(o.codeValue)} -> editor ${formatValue(o.editorValue)}`
          )
          break
        case 'in-sync':
          lines.push(
            `  override matches code (no effect): ${where}: ${formatValue(o.editorValue)}`
          )
          break
        case 'stale':
          lines.push(
            `  stale override (action not in the latest recording): ${where}: ` +
              `editor ${formatValue(o.editorValue)}`
          )
          break
        default: {
          const _exhaustive: never = o.kind
          throw new Error(`Unknown override kind: ${String(_exhaustive)}`)
        }
      }
    }
  }
  return lines
}

/**
 * Build the agent-ready sync prompt: per video, which action options to change
 * or remove in code so it matches the web editor. Returns `null` when there is
 * nothing actionable. Project and video names appear once each; stale
 * overrides are surfaced as warnings (best effort, the editor state may
 * predate a code change).
 */
export function buildSyncPrompt(
  comparison: WebStateComparison,
  projectName: string
): string | null {
  const sections: string[] = []
  for (const video of comparison.videos) {
    const actionable = video.overrides.filter(
      (o) => o.kind === 'change' || o.kind === 'remove' || o.kind === 'codify'
    )
    const stale = video.overrides.filter((o) => o.kind === 'stale')
    if (actionable.length === 0 && stale.length === 0) continue

    const lines: string[] = [`## Video: ${video.videoName}`]
    for (const o of actionable) {
      const site = `locator \`${o.selector}\`, call ${o.occurrence + 1} of \`.${o.method}(...)\``
      if (o.kind === 'remove') {
        lines.push(
          `- REMOVE the explicit \`${o.optionPath}\` option (currently ` +
            `${formatValue(o.codeValue)}) from ${site}: the editor reset it to ` +
            `the default (${formatValue(o.defaultValue)}).`
        )
      } else if (o.kind === 'change') {
        lines.push(
          `- CHANGE \`${o.optionPath}\` from ${formatValue(o.codeValue)} to ` +
            `${formatValue(o.editorValue)} on ${site}.`
        )
      } else {
        lines.push(
          `- CHANGE \`${o.optionPath}\` on ${site}: set it explicitly to ` +
            `${formatValue(o.editorValue)} (code currently uses the default ` +
            `${formatValue(o.codeValue)}).`
        )
      }
    }
    for (const o of stale) {
      lines.push(
        `- WARNING (stale): the editor overrides \`${o.optionPath}\` = ` +
          `${formatValue(o.editorValue)} on locator \`${o.selector}\` ` +
          `\`.${o.method}(...)\` call ${o.occurrence + 1}, but the latest ` +
          `recording has no such action. The code likely changed; re-check ` +
          `this override in the editor.`
      )
    }
    sections.push(lines.join('\n'))
  }

  if (sections.length === 0) return null

  return [
    `Sync the ScreenCI project "${projectName}" video scripts with the web ` +
      `editor's action-parameter edits. For each item below, update the ` +
      `matching locator action call site in the .screenci.ts scripts. ` +
      `"call N" counts calls with the same locator and method within the ` +
      `video, in execution order. After editing, re-record to confirm the ` +
      `values converge; the editor overrides can then be cleared.`,
    ...sections,
  ].join('\n\n')
}
