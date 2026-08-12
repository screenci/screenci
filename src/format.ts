/**
 * Formats codegen-edited sources with the user's own Prettier install.
 *
 * The formatter is opt-in by presence: it only runs when `prettier` is
 * resolvable from the project directory AND a Prettier config file resolves
 * for the edited file. Projects without Prettier (or after deleting the
 * config) get the raw codemod splice output, exactly as before. Formatting
 * failures never fail the codegen write; the content passes through
 * unchanged.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** The subset of the Prettier v3 API the formatter uses. */
export type PrettierModule = {
  resolveConfigFile: (filePath: string) => Promise<string | null>
  resolveConfig: (filePath: string) => Promise<Record<string, unknown> | null>
  format: (source: string, options: Record<string, unknown>) => Promise<string>
}

export type FormatFile = (path: string, content: string) => Promise<string>

export type ProjectFormatterDeps = {
  loadPrettier?: (projectDir: string) => PrettierModule | null
  warn?: (message: string) => void
}

/**
 * Load the `prettier` module from the user's project installation (resolved
 * from `projectDir`). Returns null when it does not resolve; the caller then
 * skips formatting entirely.
 */
export function loadPrettier(projectDir: string): PrettierModule | null {
  try {
    const require = createRequire(join(projectDir, 'noop.js'))
    return require('prettier') as PrettierModule
  } catch {
    return null
  }
}

/**
 * Create a `formatFile(path, content)` function bound to a project directory.
 * The prettier module is resolved lazily on first use and cached; per file,
 * the content is returned unchanged unless a config file is found for it.
 */
export function createProjectFormatter(
  projectDir: string,
  deps: ProjectFormatterDeps = {}
): FormatFile {
  const load = deps.loadPrettier ?? loadPrettier
  const warn = deps.warn ?? (() => {})
  let prettier: PrettierModule | null | undefined
  return async (path, content) => {
    try {
      if (prettier === undefined) prettier = load(projectDir)
      if (prettier === null) return content
      const configFile = await prettier.resolveConfigFile(path)
      if (configFile === null) return content
      const config = (await prettier.resolveConfig(path)) ?? {}
      return await prettier.format(content, { ...config, filepath: path })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warn(`Skipped formatting ${path}: ${message}`)
      return content
    }
  }
}
