import { spawn } from 'child_process'
import type { SpawnOptions } from 'child_process'

// Best-effort browser launcher used by `screenci login` to open the sign-in
// link for whoever can complete it. It never throws and never blocks the
// process: the caller always prints the link too, so a headless box or a
// missing opener degrades to "copy this link" rather than a failure.

export type BrowserOpenSpec = {
  command: string
  args: string[]
}

export type OpenBrowserResult =
  | { opened: true }
  | { opened: false; reason: string }

/**
 * Resolve the platform-specific command that opens a URL in the default
 * browser: `open` on macOS, `cmd /c start` on Windows, and `xdg-open`
 * everywhere else (Linux, BSD). The empty `""` on Windows is `start`'s window
 * title argument, so a quoted URL is not consumed as the title.
 */
export function resolveBrowserOpenSpec(
  url: string,
  platform: NodeJS.Platform = process.platform
): BrowserOpenSpec {
  if (platform === 'darwin') {
    return { command: 'open', args: [url] }
  }
  if (platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', url] }
  }
  return { command: 'xdg-open', args: [url] }
}

/**
 * Try to open `url` in the user's default browser. Best-effort: a synchronous
 * spawn failure or an asynchronous launch error (e.g. `xdg-open` missing on a
 * minimal Linux box) resolves to `{ opened: false, reason }` instead of
 * throwing. A resolved `{ opened: true }` only means the launch was dispatched,
 * not that a browser window actually appeared, so callers still surface the
 * link as a fallback.
 *
 * Dependency-injected (`platform`, `spawnFn`) so tests can drive both outcomes
 * without a real terminal or browser.
 */
export async function openUrlInBrowser(
  url: string,
  options: {
    platform?: NodeJS.Platform
    spawnFn?: typeof spawn
  } = {}
): Promise<OpenBrowserResult> {
  const platform = options.platform ?? process.platform
  const spawnFn = options.spawnFn ?? spawn
  const spec = resolveBrowserOpenSpec(url, platform)

  let child: ReturnType<typeof spawn>
  try {
    child = spawnFn(spec.command, spec.args, {
      stdio: 'ignore',
      detached: true,
    } as SpawnOptions)
  } catch (err) {
    return {
      opened: false,
      reason: err instanceof Error ? err.message : String(err),
    }
  }

  // Keep an error listener attached for the child's lifetime so a late launch
  // error (e.g. ENOENT) is handled rather than thrown as an unhandled event.
  const launchError = new Promise<Error>((resolveError) => {
    child.on('error', resolveError)
  })

  // Detach so the parent (login) can exit without waiting on the browser.
  child.unref()

  // ENOENT and friends surface on the next tick, ahead of this setImmediate, so
  // a failed launch wins the race; otherwise we treat the dispatch as success.
  const settled = new Promise<null>((resolveTick) => {
    setImmediate(() => resolveTick(null))
  })

  const result = await Promise.race([launchError, settled])
  return result === null
    ? { opened: true }
    : { opened: false, reason: result.message }
}
