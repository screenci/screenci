/**
 * Override debug flag, in its own dependency-free module: it is read from
 * low-level modules (event serialization, override application) that sit
 * under `runtimeContext` in the import graph, so it must not import anything
 * that could close an import cycle.
 */

/**
 * Env var enabling override debugging: the CLI dumps every override set
 * fetched from the backend before the run, and the SDK logs each override
 * value at the moment it is applied to an action.
 */
export const SCREENCI_DEBUG_OVERRIDES_ENV = 'SCREENCI_DEBUG_OVERRIDES'

/** Whether override debugging (`SCREENCI_DEBUG_OVERRIDES=1`) is on. */
export function isOverrideDebugEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    env[SCREENCI_DEBUG_OVERRIDES_ENV] === 'true' ||
    env[SCREENCI_DEBUG_OVERRIDES_ENV] === '1'
  )
}
