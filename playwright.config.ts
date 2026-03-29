import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testMatch: ['**/*.e2e.ts'],
  /* Tests within a file run sequentially; module-level singletons (e.g.
   * activeClickRecorder) are shared within a worker, so keep one worker. */
  workers: 1,
  reporter: 'list',
  use: {
    headless: true,
    /* Enable touch so locator.tap() dispatches pointer/touch events. */
    hasTouch: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], hasTouch: true },
    },
  ],
})
