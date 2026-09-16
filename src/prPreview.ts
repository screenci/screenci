import { SECRET_HEADER, type CliCredential } from './anonSession.js'

/**
 * `screenci export --pr <url>`: the run records every requested video for a
 * pull request. Nothing is selected; the service posts a check run and one
 * comment on the pull request with the finished previews, and the approved
 * versions become the served ones when the pull request merges.
 */

export type PullRequestRef = {
  owner: string
  repo: string
  number: number
  /** Canonical `https://github.com/<owner>/<repo>/pull/<number>` form. */
  url: string
}

/**
 * Parse a GitHub pull request URL. Accepts the html URL GitHub Actions
 * exposes as `github.event.pull_request.html_url`, with or without a trailing
 * path or query. Returns null for anything that is not a GitHub pull request.
 */
export function parsePullRequestUrl(input: string): PullRequestRef | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return null
  }
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/.exec(url.pathname)
  if (!match) return null
  const [, owner, repo, numberText] = match
  if (owner === undefined || repo === undefined || numberText === undefined) {
    return null
  }
  const number = Number.parseInt(numberText, 10)
  if (!Number.isSafeInteger(number) || number <= 0) return null
  return {
    owner,
    repo,
    number,
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
  }
}

export type PrPreviewCompleteParams = {
  apiUrl: string
  credential: CliCredential
  /** Names the project for an org-wide secret (a project secret ignores it). */
  projectName: string
  prUrl: string
  /** The export run's record id; null when nothing was uploaded. */
  recordId: string | null
  /** True when Playwright exited non-zero (a flow broke). */
  recordingFailed: boolean
  verbose: boolean
}

export type PrPreviewCompleteDeps = {
  fetchFn: typeof fetch
  logger: { info(message: string): void; warn(message: string): void }
}

/**
 * Tells the service the pull request run is over, so the check run and the
 * comment can settle even when no recording was uploaded (a broken flow).
 * Warns on failure instead of failing the run: the recording already
 * succeeded or failed on its own merits.
 */
export async function notifyPrPreviewComplete(
  params: PrPreviewCompleteParams,
  deps: PrPreviewCompleteDeps
): Promise<boolean> {
  if (params.credential.header !== SECRET_HEADER) {
    deps.logger.warn(
      'Pull request previews need a project secret (SCREENCI_SECRET); skipping the pull request report.'
    )
    return false
  }
  try {
    const response = await deps.fetchFn(
      `${params.apiUrl}/cli/pr-preview/complete`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [params.credential.header]: params.credential.value,
        },
        body: JSON.stringify({
          projectName: params.projectName,
          prUrl: params.prUrl,
          ...(params.recordId !== null ? { recordId: params.recordId } : {}),
          recordingFailed: params.recordingFailed,
        }),
      }
    )
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      deps.logger.warn(
        `Reporting the pull request run answered ${response.status}${text ? `: ${text}` : ''}.`
      )
      return false
    }
    if (params.verbose) {
      deps.logger.info(`Reported the pull request run for ${params.prUrl}.`)
    }
    return true
  } catch (err) {
    deps.logger.warn(
      `Reporting the pull request run failed (${err instanceof Error ? err.message : String(err)}).`
    )
    return false
  }
}
