import type { Reporter, FullConfig, Suite } from '@playwright/test/reporter'
import { sanitizeVideoName } from './sanitize.js'
import { logger } from './logger.js'

/**
 * Custom reporter that validates video names are unique after sanitization
 */
class VideoNameValidator implements Reporter {
  onBegin(config: FullConfig, suite: Suite) {
    const videoNames = new Map<string, string[]>()

    // Collect all test titles
    const collectTests = (suite: Suite) => {
      for (const test of suite.tests) {
        const sanitized = sanitizeVideoName(test.title)
        const existing = videoNames.get(sanitized)
        if (existing) {
          existing.push(test.title)
        } else {
          videoNames.set(sanitized, [test.title])
        }
      }
      for (const child of suite.suites) {
        collectTests(child)
      }
    }

    collectTests(suite)

    // Check for duplicates
    const duplicates: Array<{ sanitized: string; titles: string[] }> = []
    for (const [sanitized, titles] of videoNames.entries()) {
      if (titles.length > 1) {
        duplicates.push({ sanitized, titles })
      }
    }

    if (duplicates.length > 0) {
      logger.error('\n❌ Duplicate video names detected after sanitization:\n')
      for (const { sanitized, titles } of duplicates) {
        logger.error(`  Sanitized name: "${sanitized}"`)
        logger.error(`  Conflicts between:`)
        for (const title of titles) {
          logger.error(`    - "${title}"`)
        }
        logger.error('')
      }
      logger.error(
        'Please ensure all video titles result in unique sanitized names.'
      )
      logger.error(
        'Sanitization rules: Converted to lowercase kebab-case (alphanumeric and dashes only).\n'
      )
      process.exit(1)
    }
  }
}

export default VideoNameValidator
