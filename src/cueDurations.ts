import { createHash } from 'crypto'
import { join } from 'path'
import { logger } from './logger.js'

/**
 * Record-time narration pacing: fetches each declared cue's audio duration
 * from the backend (`POST /cli/cue-durations`) so `await narration.foo()` can
 * sleep the real narration length while recording. Purely best-effort: any
 * failure yields an empty result and the SDK falls back to frame-gap pacing,
 * with render-time frame holds keeping the output correct.
 *
 * Results are cached on disk (`.screenci/cue-durations.json`) keyed by a local
 * hash of the cue's synthesis-relevant payload, so repeat and offline runs
 * skip the network entirely.
 */

/** Cue name to audio duration (ms); null when the backend could not tell. */
export type CueDurationsMap = Map<string, number | null>

/** Synthetic cueStart-shaped event, the same shape data.json records. */
export type CueDurationEvent = {
  type: 'cueStart'
  name: string
  translations: Record<string, unknown>
}

export type FetchCueDurationsDeps = {
  fetchFn?: typeof fetch
  readFile?: (path: string) => Promise<string>
  writeFile?: (path: string, content: string) => Promise<void>
  mkdir?: (path: string) => Promise<unknown>
}

async function defaultReadFile(path: string): Promise<string> {
  const { readFile } = await import('fs/promises')
  return readFile(path, 'utf8')
}

async function defaultWriteFile(path: string, content: string): Promise<void> {
  const { writeFile } = await import('fs/promises')
  await writeFile(path, content, 'utf8')
}

async function defaultMkdir(path: string): Promise<unknown> {
  const { mkdir } = await import('fs/promises')
  return mkdir(path, { recursive: true })
}

/**
 * Local cache key for one cue: a hash of everything that changes the
 * synthesized audio (language + the recorded translation payload). Not the
 * backend cue hash; just a stable local fingerprint.
 */
export function cueDurationCacheKey(
  language: string,
  translation: unknown
): string {
  return createHash('sha256')
    .update(JSON.stringify({ language, translation }))
    .digest('hex')
}

const CACHE_FILE_NAME = 'cue-durations.json'

async function readCache(
  cacheDir: string,
  deps: FetchCueDurationsDeps
): Promise<Record<string, number>> {
  try {
    const raw = await (deps.readFile ?? defaultReadFile)(
      join(cacheDir, CACHE_FILE_NAME)
    )
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const cache: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        cache[key] = value
      }
    }
    return cache
  } catch {
    return {}
  }
}

async function writeCache(
  cacheDir: string,
  cache: Record<string, number>,
  deps: FetchCueDurationsDeps
): Promise<void> {
  try {
    await (deps.mkdir ?? defaultMkdir)(cacheDir)
    await (deps.writeFile ?? defaultWriteFile)(
      join(cacheDir, CACHE_FILE_NAME),
      JSON.stringify(cache, null, 2)
    )
  } catch {
    // Cache write failures only cost a re-fetch next run.
  }
}

export async function fetchCueDurations(params: {
  language: string
  cueEvents: CueDurationEvent[]
  backendUrl: string
  secret: string
  /** Directory holding the duration cache file, normally `.screenci`. */
  cacheDir: string
  deps?: FetchCueDurationsDeps
}): Promise<CueDurationsMap> {
  const { language, cueEvents, backendUrl, secret, cacheDir } = params
  const deps = params.deps ?? {}
  const durations: CueDurationsMap = new Map()
  if (cueEvents.length === 0) return durations

  const cacheKeyByName = new Map<string, string>()
  for (const event of cueEvents) {
    cacheKeyByName.set(
      event.name,
      cueDurationCacheKey(language, event.translations[language])
    )
  }

  const cache = await readCache(cacheDir, deps)
  const missing: CueDurationEvent[] = []
  for (const event of cueEvents) {
    const cached = cache[cacheKeyByName.get(event.name)!]
    if (cached !== undefined) {
      durations.set(event.name, cached)
    } else {
      missing.push(event)
    }
  }
  if (missing.length === 0) return durations

  try {
    const fetchFn = deps.fetchFn ?? fetch
    const res = await fetchFn(`${backendUrl}/cli/cue-durations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ScreenCI-Secret': secret,
      },
      body: JSON.stringify({ language, events: missing }),
    })
    if (!res.ok) {
      logger.warn(
        `[screenci] Cue duration lookup failed (${res.status}); narration pacing falls back to render-time holds.`
      )
      for (const event of missing) durations.set(event.name, null)
      return durations
    }
    const body = (await res.json()) as {
      durations?: Array<{ name?: unknown; durationMs?: unknown }>
    }
    const fetched = new Map<string, number | null>()
    for (const entry of body.durations ?? []) {
      if (typeof entry.name !== 'string') continue
      fetched.set(
        entry.name,
        typeof entry.durationMs === 'number' && entry.durationMs >= 0
          ? entry.durationMs
          : null
      )
    }
    let cacheChanged = false
    for (const event of missing) {
      const durationMs = fetched.get(event.name) ?? null
      durations.set(event.name, durationMs)
      // Nulls are not cached so a transient failure retries next run.
      if (durationMs !== null) {
        cache[cacheKeyByName.get(event.name)!] = durationMs
        cacheChanged = true
      }
    }
    if (cacheChanged) await writeCache(cacheDir, cache, deps)
  } catch (error) {
    logger.warn(
      `[screenci] Cue duration lookup failed; narration pacing falls back to render-time holds.${
        error instanceof Error ? ` (${error.message})` : ''
      }`
    )
    for (const event of missing) {
      if (!durations.has(event.name)) durations.set(event.name, null)
    }
  }
  return durations
}
