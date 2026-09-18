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

/** The `projectId` literal an island created from a setup code carries, if any. */
export function readIslandProjectId(configSource: string): string | undefined {
  return extractConfigStringLiteral(configSource, 'projectId')
}

/** The island's env file name (relative to the config), defaulting to `.env`. */
export function readIslandEnvFile(configSource: string): string {
  return extractConfigStringLiteral(configSource, 'envFile') ?? '.env'
}

/** `use.baseURL` literal of the island config, when it sets one. */
export function readIslandBaseUrl(configSource: string): string | undefined {
  return extractNestedStringLiteral(configSource, 'use', 'baseURL')
}

/** `webServer.url` literal of the island config, when it sets one. */
export function readIslandWebServerUrl(
  configSource: string
): string | undefined {
  return extractNestedStringLiteral(configSource, 'webServer', 'url')
}

/**
 * `<block>: { ... <property>: '<literal>' ... }`, the nearest property after
 * the block opens. Same quote handling as `extractConfigStringLiteral`.
 */
function extractNestedStringLiteral(
  configSource: string,
  block: string,
  property: string
): string | undefined {
  const blockMatch = new RegExp('(?<![\\w$.])' + block + '\\s*:\\s*\\{').exec(
    configSource
  )
  if (!blockMatch) return undefined
  const rest = configSource.slice(blockMatch.index + blockMatch[0].length)
  const body = blockBody(rest)
  // Only the block's own properties: nested objects (env, viewport, ...) are
  // blanked so a same-named key inside them cannot answer for the block.
  const own = withoutNestedObjects(body)
  for (const quote of ["'", '"', '`']) {
    const match = new RegExp(
      '(?<![\\w$.])' +
        property +
        '\\s*:\\s*' +
        quote +
        '([^' +
        quote +
        '\\n]+)' +
        quote
    ).exec(own)
    if (match) return match[1]
  }
  return undefined
}

/** The text up to the brace that closes an already-opened block. */
function blockBody(rest: string): string {
  let depth = 1
  for (let i = 0; i < rest.length; i++) {
    const char = rest[i]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return rest.slice(0, i)
    }
  }
  return rest
}

/** Replaces every nested `{ ... }` with spaces, keeping offsets stable. */
function withoutNestedObjects(body: string): string {
  let out = ''
  let depth = 0
  for (const char of body) {
    if (char === '{') {
      depth += 1
      out += ' '
    } else if (char === '}') {
      depth = Math.max(0, depth - 1)
      out += ' '
    } else {
      out += depth === 0 ? char : ' '
    }
  }
  return out
}
