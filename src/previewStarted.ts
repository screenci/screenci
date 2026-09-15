import type { CliCredential } from './anonSession.js'
import { detectRunnerKind, type RunnerKind } from './git.js'

export type PreviewStartNotice = {
  apiUrl: string
  credential: CliCredential
  projectName: string
  /** Where the CLI runs; detected when omitted. Picks the preview slot. */
  runner?: RunnerKind
}

/**
 * Best-effort "preview recording started" ping, fired right before Playwright
 * launches a preview record. The web editor's preview page uses it to show a
 * live "recording in progress" indicator before any upload lands. Never
 * throws and never blocks recording: failures are silently ignored (the
 * landed preview supersedes the indicator anyway).
 */
export async function notifyPreviewRecordingStarted(
  notice: PreviewStartNotice,
  videoNames: readonly string[],
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  if (videoNames.length === 0) return
  try {
    await fetchImpl(`${notice.apiUrl}/cli/preview-recording-started`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [notice.credential.header]: notice.credential.value,
      },
      body: JSON.stringify({
        projectName: notice.projectName,
        videoNames: [...videoNames],
        runner: notice.runner ?? detectRunnerKind(),
      }),
    })
  } catch {
    // Best-effort only.
  }
}
