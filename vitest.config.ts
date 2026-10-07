import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Unit tests must behave the same on a laptop and in CI: the CI-only
    // preflight (secret check, browser install) is tested via its own deps.
    env: { SCREENCI_CI: '0', SCREENCI_SKIP_BROWSER_INSTALL: '1' },
    pool: 'forks',
    execArgv: ['--max-old-space-size=8192'],
  },
})
