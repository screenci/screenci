import { describe, expect, it, vi } from 'vitest'
import {
  ensureCiBrowserInstalled,
  getMissingCiSecretError,
} from './ciPreflight'

const SECRETS_URL = 'https://app.screenci.com/secrets'

describe('getMissingCiSecretError', () => {
  it('returns null outside CI', () => {
    expect(getMissingCiSecretError({}, SECRETS_URL)).toBeNull()
  })

  it('returns null in CI with the secret set', () => {
    expect(
      getMissingCiSecretError(
        { CI: 'true', SCREENCI_SECRET: 'sk_123' },
        SECRETS_URL
      )
    ).toBeNull()
  })

  it('errors in CI without the secret', () => {
    const message = getMissingCiSecretError(
      { GITHUB_ACTIONS: 'true' },
      SECRETS_URL
    )
    expect(message).toContain('SCREENCI_SECRET is not set')
    expect(message).toContain(SECRETS_URL)
  })

  it('treats an empty secret as missing', () => {
    expect(
      getMissingCiSecretError({ CI: 'true', SCREENCI_SECRET: '' }, SECRETS_URL)
    ).not.toBeNull()
  })

  it('honors SCREENCI_CI=0 as local', () => {
    expect(
      getMissingCiSecretError({ CI: 'true', SCREENCI_CI: '0' }, SECRETS_URL)
    ).toBeNull()
  })
})

describe('ensureCiBrowserInstalled', () => {
  const makeDeps = (env: NodeJS.ProcessEnv, code = 0) => ({
    env,
    runPlaywrightInstall: vi.fn().mockResolvedValue(code),
    log: vi.fn(),
  })

  it('skips outside CI', async () => {
    const deps = makeDeps({})
    expect(await ensureCiBrowserInstalled(deps)).toBe('skipped')
    expect(deps.runPlaywrightInstall).not.toHaveBeenCalled()
  })

  it('installs the headless shell in CI', async () => {
    const deps = makeDeps({ CI: 'true' })
    expect(await ensureCiBrowserInstalled(deps)).toBe('installed')
    expect(deps.runPlaywrightInstall).toHaveBeenCalledWith([
      'install',
      '--only-shell',
      'chromium',
    ])
  })

  it('reports a failed install', async () => {
    const deps = makeDeps({ CI: 'true' }, 1)
    expect(await ensureCiBrowserInstalled(deps)).toBe('failed')
  })

  it('can be opted out of', async () => {
    const deps = makeDeps({ CI: 'true', SCREENCI_SKIP_BROWSER_INSTALL: '1' })
    expect(await ensureCiBrowserInstalled(deps)).toBe('skipped')
    expect(deps.runPlaywrightInstall).not.toHaveBeenCalled()
  })
})
