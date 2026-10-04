import { afterEach, describe, expect, it, vi } from 'vitest'
import { sourceSyncDeps } from './cli.js'
import {
  CLI_VERSION_HEADER,
  installCliVersionHeader,
} from './src/cliVersionHeader.js'

describe('sourceSyncDeps.fetchFn', () => {
  const original = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = original
  })

  it('uses the version-header fetch installed after the module loaded', async () => {
    const base = vi.fn(async () => new Response('{}'))
    globalThis.fetch = base as unknown as typeof fetch
    // main() installs the header wrapper after cli.ts is imported.
    installCliVersionHeader('9.9.9')

    await sourceSyncDeps.fetchFn('https://api.example/cli/run-complete', {
      method: 'POST',
    })

    expect(base).toHaveBeenCalledTimes(1)
    const init = (base.mock.calls[0] as unknown[])[1] as RequestInit
    expect(new Headers(init.headers).get(CLI_VERSION_HEADER)).toBe('9.9.9')
  })
})
