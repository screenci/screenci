import { logger } from './logger.js'
import { isCI } from './git.js'

/**
 * A locally missing asset is an expected, recoverable situation (the file was
 * uploaded on a previous record and is reused by path), not a problem, so it is
 * surfaced as an informational notice rather than a warning. On CI the wording
 * makes clear this is the normal case (asset files are typically not committed).
 */
export function logMissingAsset(kind: string, path: string): void {
  const reuse =
    'It will be reused from a previous upload of this video if available, otherwise the upload fails.'
  const message = isCI()
    ? `Locally missing ${kind}: ${path}. Not committed to CI, as expected. ${reuse}`
    : `Locally missing ${kind}: ${path}. ${reuse}`
  logger.info(message)
}
