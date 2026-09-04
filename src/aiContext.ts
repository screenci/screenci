import { SECRET_HEADER } from './anonSession.js'

/**
 * The organisation's AI context as the service resolves it for a project:
 * where the product's source code lives, where it runs, whether the agent may
 * start it from the repository, whether it sits behind a sign-in, and
 * free-form notes. Fetched by `screenci start` (in the setup-code exchange)
 * and `screenci context` (`GET /cli/dev/ai-context`).
 *
 * No credential is part of this, or of anything else the service hands the
 * CLI. Signing in to the person's own product happens on their machine, in a
 * browser they drive themselves (`screenci login`), and the session it
 * captures never leaves that machine.
 */

export type AiContextSource = 'project' | 'org' | 'none'

export type CliAiContext = {
  gitUrl: string | null
  siteUrl: string | null
  runLocallyIfNeeded: boolean
  /** The team says the site needs a sign-in, so the agent runs `screenci login`. */
  siteRequiresLogin: boolean
  /**
   * The package manager the team wants used for install and script commands.
   * `null` means they did not say, and the lockfile decides.
   */
  packageManager: 'npm' | 'pnpm' | 'yarn' | null
  guide: string | null
  sources: {
    gitUrl: AiContextSource
    siteUrl: AiContextSource
    runLocallyIfNeeded: AiContextSource
    siteRequiresLogin: AiContextSource
    packageManager: AiContextSource
    guide: AiContextSource
  }
}

export const EMPTY_AI_CONTEXT: CliAiContext = {
  gitUrl: null,
  siteUrl: null,
  runLocallyIfNeeded: false,
  siteRequiresLogin: false,
  packageManager: null,
  guide: null,
  sources: {
    gitUrl: 'none',
    siteUrl: 'none',
    runLocallyIfNeeded: 'none',
    siteRequiresLogin: 'none',
    packageManager: 'none',
    guide: 'none',
  },
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function optionalPackageManager(
  value: unknown
): 'npm' | 'pnpm' | 'yarn' | null {
  return value === 'npm' || value === 'pnpm' || value === 'yarn' ? value : null
}

function source(value: unknown): AiContextSource {
  return value === 'project' || value === 'org' ? value : 'none'
}

/** Tolerant parse: an older server (no context at all) yields the empty context. */
export function parseAiContext(value: unknown): CliAiContext {
  if (typeof value !== 'object' || value === null) return EMPTY_AI_CONTEXT
  const v = value as Record<string, unknown>
  const sources = (
    typeof v.sources === 'object' && v.sources !== null ? v.sources : {}
  ) as Record<string, unknown>
  return {
    gitUrl: optionalString(v.gitUrl),
    siteUrl: optionalString(v.siteUrl),
    runLocallyIfNeeded: v.runLocallyIfNeeded === true,
    siteRequiresLogin: v.siteRequiresLogin === true,
    packageManager: optionalPackageManager(v.packageManager),
    guide: optionalString(v.guide),
    sources: {
      gitUrl: source(sources.gitUrl),
      siteUrl: source(sources.siteUrl),
      runLocallyIfNeeded: source(sources.runLocallyIfNeeded),
      siteRequiresLogin: source(sources.siteRequiresLogin),
      packageManager: source(sources.packageManager),
      guide: source(sources.guide),
    },
  }
}

export type FetchAiContextResult =
  | {
      ok: true
      context: CliAiContext
      projectName: string | null
      sourceMode: 'service' | 'local' | null
    }
  | { ok: false; message: string }

/** `GET /cli/dev/ai-context` for `screenci context`. */
export async function fetchAiContext(
  params: {
    apiUrl: string
    secret: string
    projectName?: string | undefined
  },
  fetchFn: typeof fetch
): Promise<FetchAiContextResult> {
  const url = new URL(`${params.apiUrl}/cli/dev/ai-context`)
  if (params.projectName !== undefined) {
    url.searchParams.set('projectName', params.projectName)
  }
  let response: Response
  try {
    response = await fetchFn(url.toString(), {
      headers: { [SECRET_HEADER]: params.secret },
    })
  } catch (err) {
    return {
      ok: false,
      message: `Could not reach ScreenCI: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return {
      ok: false,
      message: `Fetching the AI context failed with status ${response.status}${text ? `: ${text}` : ''}`,
    }
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, message: 'The AI context response is not JSON' }
  }
  const b = (body ?? {}) as Record<string, unknown>
  return {
    ok: true,
    context: parseAiContext(body),
    projectName: optionalString(b.projectName),
    sourceMode:
      b.sourceMode === 'service' || b.sourceMode === 'local'
        ? b.sourceMode
        : null,
  }
}
