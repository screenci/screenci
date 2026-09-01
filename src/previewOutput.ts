/**
 * Pure formatting helpers for the user-facing output of `screenci preview`.
 * Kept side-effect free so every line the user reads is unit-testable: the
 * post-upload editor-settings notice.
 */

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
