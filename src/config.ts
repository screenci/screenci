import type { ReporterDescription } from '@playwright/test'
import type { ScreenCIConfig, ExtendedScreenCIConfig } from './types.js'
import {
  DEFAULT_VIDEO_DIR,
  DEFAULT_TRACE,
  DEFAULT_TIMEOUT,
  DEFAULT_ACTION_TIMEOUT,
  DEFAULT_NAVIGATION_TIMEOUT,
} from './defaults.js'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { existsSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Resolve reporter path - try .js first (production), then .ts (development)
const reporterPathJs = resolve(__dirname, 'reporter.js')
const reporterPathTs = resolve(__dirname, 'reporter.ts')
const reporterPath = existsSync(reporterPathJs)
  ? reporterPathJs
  : reporterPathTs

type ReporterConfig = string | ReporterDescription

/**
 * Defines a screenci configuration file.
 *
 * Extends Playwright's config with screenci-specific options and enforces
 * settings required for reliable video recording. Some Playwright options
 * are locked and cannot be set — `workers`, `fullyParallel`, `retries`,
 * `testDir`, and `testMatch`. Attempting to set them throws at startup.
 *
 * @example
 * Minimal — all options have sensible defaults:
 * ```ts
 * import { defineConfig } from 'screenci'
 * export default defineConfig({})
 * ```
 *
 * @example
 * Full config:
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
 *       fps: 30,              // 24 | 30 | 60
 *     },
 *     trace: 'retain-on-failure',
 *   },
 * })
 * ```
 *
 * @param config - screenci configuration options
 * @returns Extended Playwright configuration with enforced sequential execution settings
 */
export function defineConfig(config: ScreenCIConfig): ExtendedScreenCIConfig {
  // Add the video name validator reporter if not already present
  const existingReporters = config.reporter
    ? Array.isArray(config.reporter)
      ? config.reporter
      : [config.reporter]
    : ['list']

  // Check if our validator is already added
  const hasValidator = existingReporters.some((r: ReporterConfig) => {
    if (Array.isArray(r)) {
      return r[0] === reporterPath || r[0]?.toString().endsWith('reporter.js')
    }
    return r === reporterPath || r?.toString().endsWith('reporter.js')
  })

  // Convert all reporters to tuple format for Playwright validation
  const normalizedReporters = existingReporters.map((r: ReporterConfig) =>
    Array.isArray(r) ? r : [r]
  )

  // Check if list reporter is present for CLI output
  const hasListReporter = normalizedReporters.some((r) => {
    const name = Array.isArray(r) ? r[0] : r
    return name === 'list' || name === 'line' || name === 'dot'
  })

  // Build reporters array with proper typing - all reporters must be tuples
  // Add list reporter if no CLI reporter is present
  const reportersWithCLI = hasListReporter
    ? normalizedReporters
    : ([['list'], ...normalizedReporters] as [string, unknown][])

  const reporters = hasValidator
    ? reportersWithCLI
    : ([[reporterPath, {}], ...reportersWithCLI] as [string, unknown][])

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

  // Runtime check for workers
  if ('workers' in config) {
    throw new Error(
      'screenci does not support "workers" option. ' +
        'Tests must run sequentially to ensure proper video recording. ' +
        'screenci automatically configures workers to 1.'
    )
  }

  // Runtime check for fullyParallel
  if ('fullyParallel' in config) {
    throw new Error(
      'screenci does not support "fullyParallel" option. ' +
        'Tests must run sequentially to ensure proper video recording. ' +
        'screenci automatically sets fullyParallel to false.'
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

  const { videoDir, ...rest } = config

  // Force sequential execution with single worker and no retries, map videoDir to testDir
  return {
    testDir: videoDir ?? DEFAULT_VIDEO_DIR,
    testMatch: '**/*.video.?(c|m)[jt]s?(x)',
    ...rest,
    reporter: reporters as ReporterDescription[],
    use: {
      ...rest.use,
      trace: rest.use?.trace ?? DEFAULT_TRACE,
      actionTimeout: rest.use?.actionTimeout ?? DEFAULT_ACTION_TIMEOUT,
      navigationTimeout:
        rest.use?.navigationTimeout ?? DEFAULT_NAVIGATION_TIMEOUT,
    },
    timeout: rest.timeout ?? DEFAULT_TIMEOUT,
    fullyParallel: false,
    workers: 1,
    retries: 0,
  }
}
