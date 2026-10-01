/** Header the backend reads to refuse CLI versions it no longer supports. */
export const CLI_VERSION_HEADER = 'X-ScreenCI-CLI-Version'

type Fetch = typeof globalThis.fetch

function requestPath(input: Parameters<Fetch>[0]): string | null {
  try {
    if (typeof input === 'string') return new URL(input).pathname
    if (input instanceof URL) return input.pathname
    return new URL(input.url).pathname
  } catch {
    return null
  }
}

/**
 * Wraps fetch so every request to a ScreenCI `/cli/*` endpoint carries the
 * CLI version. Other requests (signed storage URLs, registries) pass through
 * untouched.
 */
export function withCliVersionHeader(baseFetch: Fetch, version: string): Fetch {
  return (input, init) => {
    const path = requestPath(input)
    if (path === null || !path.startsWith('/cli/')) {
      return baseFetch(input, init)
    }
    return baseFetch(input, {
      ...init,
      headers: addHeader(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
        version
      ),
    })
  }
}

/** Adds the version header while keeping the caller's header shape. */
function addHeader(
  headers: HeadersInit | undefined,
  version: string
): HeadersInit {
  if (headers instanceof Headers) {
    const copy = new Headers(headers)
    copy.set(CLI_VERSION_HEADER, version)
    return copy
  }
  if (Array.isArray(headers)) {
    return [...headers, [CLI_VERSION_HEADER, version]]
  }
  return { ...headers, [CLI_VERSION_HEADER]: version }
}

/** Installs the wrapper on the global fetch for the CLI process. */
export function installCliVersionHeader(version: string): void {
  globalThis.fetch = withCliVersionHeader(globalThis.fetch, version)
}
