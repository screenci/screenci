import type { ScreenCIConfig, ExtendedScreenCIConfig } from './types.js'
import {
  DEFAULT_VIDEO_DIR,
  DEFAULT_RECORD_UPLOAD_POLICY,
  DEFAULT_TIMEOUT,
  DEFAULT_ACTION_TIMEOUT,
  DEFAULT_NAVIGATION_TIMEOUT,
} from './defaults.js'

/**
 * Defines a screenci configuration file.
 *
 * Extends Playwright's config with screenci-specific options.
 * `retries`, `testDir`, and `testMatch` are managed by screenci
 * and cannot be set.
 *
 * @example
 * Minimal — all options have sensible defaults:
 * ```ts
 * import { defineConfig } from 'screenci'
 * export default defineConfig({})
 * ```
 *
 * @example
 * ```ts
 * import { defineConfig } from 'screenci'
 *
 * export default defineConfig({
 *   projectName: 'my-project',
 *   videoDir: './videos',
 *   use: {
 *     baseURL: 'https://app.example.com',
 *     recordOptions: {
 *       aspectRatio: '16:9',  // '16:9' | '9:16' | '1:1' | '4:3' | ...
 *       quality: '1080p',     // '720p' | '1080p' | '1440p' | '2160p'
 *       fps: 60,              // 24 | 30 | 60
 *     },
 *     trace: 'retain-on-failure',
 *   },
 * })
 * ```
 *
 * @param config - screenci configuration options
 * @returns Extended Playwright configuration with screenci-managed test discovery
 */
export function defineConfig(config: ScreenCIConfig): ExtendedScreenCIConfig {
  const isRecording = process.env.SCREENCI_RECORDING === 'true'

  // Runtime check for viewport (check before testDir since test objects may not have testDir defined)
  if (config.use && 'viewport' in config.use) {
    throw new Error(
      'screenci does not support "viewport" option. ' +
        'The viewport is automatically set based on the recordOptions.resolution. ' +
        'Use recordOptions.resolution to control the viewport size.'
    )
  }

  // Runtime check for viewport in projects
  if (config.projects) {
    for (const project of config.projects) {
      if (project.use && 'viewport' in project.use) {
        throw new Error(
          `screenci does not support "viewport" option in project "${project.name}". ` +
            'The viewport is automatically set based on the recordOptions.resolution. ' +
            'Use recordOptions.resolution to control the viewport size.'
        )
      }
    }
  }

  // Runtime check for testDir
  if (
    Object.prototype.hasOwnProperty.call(config, 'testDir') &&
    (config as Record<string, unknown>).testDir !== undefined
  ) {
    throw new Error(
      'screenci does not support "testDir" option. ' +
        'Use "videoDir" instead to specify the directory containing your *.video.* files. ' +
        'Defaults to "./videos".'
    )
  }

  // Runtime check for testMatch
  if ('testMatch' in config) {
    throw new Error(
      'screenci does not support "testMatch" option. ' +
        'screenci automatically configures tests to only run *.video.* files.'
    )
  }

  // Runtime check for retries
  if ('retries' in config) {
    throw new Error(
      'screenci does not support "retries" option. ' +
        'Tests must succeed immediately or fail to ensure proper video recording. ' +
        'screenci automatically sets retries to 0.'
    )
  }

  const { videoDir, record, ...rest } = config

  // recording does not need tracing, also it takes resources so that is why forced off
  const trace = isRecording ? 'off' : rest.use?.trace
  const projects = isRecording
    ? rest.projects?.map((project) => ({
        ...project,
        use: {
          ...project.use,
          trace: 'off' as const,
        },
      }))
    : rest.projects
  const use = {
    ...rest.use,
    ...(trace !== undefined ? { trace } : {}),
    actionTimeout: rest.use?.actionTimeout ?? DEFAULT_ACTION_TIMEOUT,
    navigationTimeout:
      rest.use?.navigationTimeout ?? DEFAULT_NAVIGATION_TIMEOUT,
  }

  // Map videoDir to testDir and keep screenci-managed defaults in place.
  return {
    testDir: videoDir ?? DEFAULT_VIDEO_DIR,
    testMatch: '**/*.video.?(c|m)[jt]s?(x)',
    ...rest,
    record: {
      upload: record?.upload ?? DEFAULT_RECORD_UPLOAD_POLICY,
    },
    ...(rest.reporter !== undefined ? { reporter: rest.reporter } : {}),
    use,
    ...(projects ? { projects } : {}),
    timeout: rest.timeout ?? DEFAULT_TIMEOUT,
    retries: 0,
  }
}
