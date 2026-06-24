import type { ScreenCIConfig, ExtendedScreenCIConfig } from './types.js'
import {
  DEFAULT_RECORDING_DIR,
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
 *   recordingDir: './recordings',
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
  const normalizeReporter = (
    reporter: NonNullable<ScreenCIConfig['reporter']>
  ): NonNullable<ScreenCIConfig['reporter']> => {
    if (!isRecording) return reporter

    // Keep the HTML report generated, but never auto-open it while recording.
    if (reporter === 'html') {
      return [['html', { open: 'never' }]]
    }

    if (Array.isArray(reporter)) {
      return reporter.map((entry) => {
        if (
          Array.isArray(entry) &&
          entry[0] === 'html' &&
          (entry[1] === undefined || typeof entry[1] === 'object')
        ) {
          return ['html', { ...(entry[1] ?? {}), open: 'never' }]
        }

        return entry
      }) as NonNullable<ScreenCIConfig['reporter']>
    }

    return reporter
  }

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
        'Use "recordingDir" instead to specify the directory containing your *.screenci.* files. ' +
        'Defaults to "./recordings".'
    )
  }

  // Runtime check for the renamed videoDir option
  if ('videoDir' in config) {
    throw new Error(
      'screenci renamed "videoDir" to "recordingDir". ' +
        'Rename the option in your config to specify the directory containing your *.screenci.* files. ' +
        'Defaults to "./recordings".'
    )
  }

  // Runtime check for testMatch
  if ('testMatch' in config) {
    throw new Error(
      'screenci does not support "testMatch" option. ' +
        'screenci automatically configures tests to only run *.screenci.* files.'
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

  const { recordingDir, record, test, ...rest } = config
  const reporter =
    rest.reporter !== undefined ? normalizeReporter(rest.reporter) : undefined

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

  // Map recordingDir to testDir and keep screenci-managed defaults in place.
  return {
    testDir: recordingDir ?? DEFAULT_RECORDING_DIR,
    testMatch: [
      '**/*.screenci.?(c|m)[jt]s?(x)',
      // Deprecated alias kept only for backward compatibility: legacy
      // `.video.ts` files are still discovered. Not documented anywhere; all
      // new files use `.screenci.ts`. Do not surface this in docs or output.
      '**/*.video.?(c|m)[jt]s?(x)',
    ],
    ...rest,
    record: {
      upload: record?.upload ?? DEFAULT_RECORD_UPLOAD_POLICY,
    },
    test: {
      mockRecord: test?.mockRecord ?? false,
    },
    ...(reporter !== undefined ? { reporter } : {}),
    use,
    ...(projects ? { projects } : {}),
    timeout: rest.timeout ?? DEFAULT_TIMEOUT,
    retries: 0,
  }
}
