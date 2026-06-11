import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    execArgv: ['--max-old-space-size=8192'],
  },
})
