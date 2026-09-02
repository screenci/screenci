import type { RecordUploadPolicy } from './types.js'

// Cheap, import-free readers for `screenci.config.ts`. They scrape string
// literals from the source text so a command can learn the project identity
// without evaluating the module (which needs the island's node_modules, and
// may collide with an already-loaded Playwright). Dynamic values are invisible
// to these readers by design; callers that need the real value evaluate the
// config instead (see loadRecordConfigWithoutPlaywrightCollision in cli.ts).

export type ConfigStringProperty = 'projectName' | 'envFile' | 'projectId'

export function extractConfigStringLiteral(
  configSource: string,
  property: ConfigStringProperty
): string | undefined {
  const singleQuoteMatch = configSource.match(
    new RegExp(property + "\\s*:\\s*'([^'\\n]+)'")
  )
  if (singleQuoteMatch) return singleQuoteMatch[1]

  const doubleQuoteMatch = configSource.match(
    new RegExp(property + '\\s*:\\s*"([^"\\n]+)"')
  )
  if (doubleQuoteMatch) return doubleQuoteMatch[1]

  const templateLiteralMatch = configSource.match(
    new RegExp(property + '\\s*:\\s*`([^`\\n]+)`')
  )
  return templateLiteralMatch?.[1]
}

export function extractRecordUploadPolicyLiteral(
  configSource: string
): RecordUploadPolicy | undefined {
  const singleQuoteMatch = configSource.match(
    /record\s*:\s*\{[\s\S]*?upload\s*:\s*'(passed-only|all-or-nothing)'/
  )
  if (singleQuoteMatch) {
    return singleQuoteMatch[1] as RecordUploadPolicy
  }

  const doubleQuoteMatch = configSource.match(
    /record\s*:\s*\{[\s\S]*?upload\s*:\s*"(passed-only|all-or-nothing)"/
  )
  if (doubleQuoteMatch) {
    return doubleQuoteMatch[1] as RecordUploadPolicy
  }

  const templateLiteralMatch = configSource.match(
    /record\s*:\s*\{[\s\S]*?upload\s*:\s*`(passed-only|all-or-nothing)`/
  )
  return templateLiteralMatch?.[1] as RecordUploadPolicy | undefined
}

export function extractMockRecordLiteral(
  configSource: string
): boolean | undefined {
  const match = configSource.match(
    /test\s*:\s*\{[\s\S]*?mockRecord\s*:\s*(true|false)/
  )

  if (!match) return undefined

  return match[1] === 'true'
}

/** The `projectId` literal of a service-managed island, if the config has one. */
export function readIslandProjectId(configSource: string): string | undefined {
  return extractConfigStringLiteral(configSource, 'projectId')
}

/** The island's env file name (relative to the config), defaulting to `.env`. */
export function readIslandEnvFile(configSource: string): string {
  return extractConfigStringLiteral(configSource, 'envFile') ?? '.env'
}

/**
 * Removes the `projectId: '...'` entry from a config's source text (the line,
 * or the inline `projectId: '...',` when the object is on one line), turning
 * a service-managed island into a repository-managed one. Returns the source
 * unchanged when no projectId is present.
 */
export function stripIslandProjectId(configSource: string): string {
  const lineForm = /^[ \t]*projectId\s*:\s*(['"`])[^'"`\n]*\1\s*,?[ \t]*\r?\n/m
  if (lineForm.test(configSource)) return configSource.replace(lineForm, '')
  const inlineForm = /\s*projectId\s*:\s*(['"`])[^'"`\n]*\1\s*,?/
  return configSource.replace(inlineForm, '')
}
