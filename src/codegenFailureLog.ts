/**
 * Coalesced logging for codegen-apply failures.
 *
 * A single web action can queue many edits that all fail for the same root
 * cause (adding a language queues one narration edit per cue; a missing
 * `video(...)` declaration fails every one of them identically). Logging each
 * failure verbatim produced a wall of near-identical lines. This logger
 * prints ONE concise line per (video, cause) burst and a short "(N more ...)"
 * follow-up once the burst settles.
 */

export type CodegenFailureLog = {
  /** Report one failed edit; identical-cause failures within the coalescing
   *  window collapse into the first line plus a count. */
  logFailure: (input: {
    videoName: string
    /** Human description of the edit, e.g. `the "intro" narration (et)`. */
    editDescription: string
    /** The raw apply error message (may carry a `[reason-code]` marker). */
    message: string
  }) => void
}

/** How long a burst may keep adding identical failures to one line. */
const COALESCE_MS = 3000

/** The `[reason-code]` marker embedded in apply refusals, used as the
 *  coalescing key so per-cue detail differences still collapse. */
function reasonCodeOf(message: string): string {
  return /\[[a-z-]+\]/.exec(message)?.[0] ?? message
}

/**
 * One concise line for the burst's first failure. The unknown-video refusal
 * (a declaration the project no longer has, usually a rename in code) gets a
 * dedicated actionable message; everything else keeps the raw error.
 */
export function formatCodegenFailureLine(input: {
  videoName: string
  editDescription: string
  message: string
}): string {
  if (input.message.includes('[unknown-video]')) {
    return (
      `Could not apply edits to "${input.videoName}": no video with that ` +
      `name is declared in this project (was it renamed or removed in ` +
      `code?). The edits are marked failed in the editor.`
    )
  }
  return `Codegen for ${input.editDescription} (${input.videoName}) failed: ${input.message}`
}

export function createCodegenFailureLog(
  error: (line: string) => void,
  options: {
    coalesceMs?: number
    /** Injectable timer for tests. */
    schedule?: (fn: () => void, ms: number) => void
  } = {}
): CodegenFailureLog {
  const coalesceMs = options.coalesceMs ?? COALESCE_MS
  const schedule =
    options.schedule ??
    ((fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms)
      // Never keep the CLI process alive just for a pending summary line.
      ;(timer as { unref?: () => void }).unref?.()
    })
  /** key -> number of additional identical failures suppressed this burst. */
  const suppressed = new Map<string, number>()

  return {
    logFailure(input) {
      const key = `${input.videoName}|${reasonCodeOf(input.message)}`
      const count = suppressed.get(key)
      if (count !== undefined) {
        suppressed.set(key, count + 1)
        return
      }
      suppressed.set(key, 0)
      schedule(() => {
        const more = suppressed.get(key) ?? 0
        suppressed.delete(key)
        if (more > 0) {
          error(
            `(${more} more edit${more === 1 ? '' : 's'} for ` +
              `"${input.videoName}" failed for the same reason.)`
          )
        }
      }, coalesceMs)
      error(formatCodegenFailureLine(input))
    },
  }
}
