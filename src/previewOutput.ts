/**
 * Pure formatting helpers for the user-facing output of `screenci preview`
 * and `screenci sync`. Kept side-effect free so every line the user reads is
 * unit-testable: the drain summary, the per-edit apply line (--watch), and
 * the post-upload editor-settings notice.
 */

/** The backend's fallback author name for identity-less or anonymous edits. */
const UNKNOWN_QUEUED_BY = 'Unknown user'

/**
 * One-line summary of an edit drain. Null when there is nothing to report
 * (no edits handled and none failed).
 */
export function formatDrainSummary(counts: {
  handled: number
  failed: number
}): string | null {
  const { handled, failed } = counts
  if (handled === 0 && failed === 0) return null
  const synced = `Synced ${handled} editor edit${handled === 1 ? '' : 's'}`
  if (failed === 0) return `${synced} into your sources.`
  return `${synced}; ${failed} edit${failed === 1 ? '' : 's'} could not be applied.`
}

/**
 * The per-edit apply line printed by live (`--watch`) sessions. The queued-by
 * suffix is omitted when the author is unknown (missing, empty, or the
 * backend's "Unknown user" fallback): naming an unknown author only confuses.
 */
export function formatAppliedEditLine(input: {
  editDescription: string
  videoName: string
  queuedBy?: string | undefined
  requiresRecord: boolean
}): string {
  const queuedBy =
    input.queuedBy !== undefined &&
    input.queuedBy.trim() !== '' &&
    input.queuedBy !== UNKNOWN_QUEUED_BY
      ? ` (queued by ${input.queuedBy})`
      : ''
  const trailer = input.requiresRecord
    ? ''
    : ' Applies at render time, no re-record needed.'
  return `Applied ${input.editDescription} to "${input.videoName}"${queuedBy}.${trailer}`
}

/** Strips a trailing per-language suffix (` [en]`, ` [pt-br]`) from an
 *  uploaded pass's display name, yielding the video's base name. */
export function baseVideoName(name: string): string {
  return name.replace(/\s\[[a-z-]+\]$/i, '')
}

export type AppliedStudioNotice = {
  videoName: string
  videoId: string | null
}

/**
 * Dedupes per-language `{ applied: true }` studio notices into one entry per
 * video (by videoId, falling back to the base video name), so the settings
 * notice prints once per video instead of once per uploaded language pass.
 */
export function dedupeAppliedStudioNotices<T extends AppliedStudioNotice>(
  notices: T[]
): T[] {
  const seen = new Set<string>()
  const deduped: T[] = []
  for (const notice of notices) {
    const key = notice.videoId ?? `name:${baseVideoName(notice.videoName)}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(notice)
  }
  return deduped
}

/** The one-line post-upload notice that editor-uploaded media (overlays,
 *  audio tracks, narration audio, cloned voices) shapes the render of the new
 *  upload. Everything else is code-owned and already in the sources. */
export function formatStudioNoticeLine(videoBaseName: string): string {
  return `Editor-uploaded media for "${videoBaseName}" applies at render time; recordings always run from code.`
}
