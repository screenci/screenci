import { spawnSync as nodeSpawnSync } from 'node:child_process'
import { existsSync as nodeExistsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'

/**
 * Resolves the ffmpeg executable screenci spawns, self-healing a skipped
 * `ffmpeg-static` install.
 *
 * `ffmpeg-static` downloads its binary in a postinstall script. pnpm 10/11
 * (and soon npm) skip dependency build scripts unless the user approves them,
 * which leaves the package exporting a path to a file that was never
 * downloaded. Rather than failing at render time with a cryptic ENOENT, we run
 * the package's own `install.js` once on demand and only give up (with an
 * actionable message) when the binary is still missing afterwards.
 */

export const FFMPEG_MISSING_MESSAGE =
  "ffmpeg binary missing: your package manager skipped ffmpeg-static's install script. Run `pnpm approve-builds` and `pnpm rebuild ffmpeg-static` (or `npm rebuild ffmpeg-static`), or set FFMPEG_BIN to an ffmpeg executable."

export const FFMPEG_UNSUPPORTED_PLATFORM_MESSAGE =
  'ffmpeg binary unavailable: ffmpeg-static ships no build for this platform. Set FFMPEG_BIN to an ffmpeg executable.'

export type FfmpegPathDeps = {
  /** The path `ffmpeg-static` exports, or null on an unsupported platform. */
  ffmpegStatic: string | null
  existsSync: (path: string) => boolean
  /** Removes a file, ignoring a missing one. Used to drop a partial download. */
  removeFile: (path: string) => void
  spawnSync: (
    command: string,
    args: string[],
    options: { stdio: 'inherit' }
  ) => { status: number | null; error?: Error | undefined }
  env: Record<string, string | undefined>
  log: (line: string) => void
}

const defaultDeps: FfmpegPathDeps = {
  ffmpegStatic: ffmpegStatic as unknown as string | null,
  existsSync: nodeExistsSync,
  removeFile: (path) => rmSync(path, { force: true }),
  spawnSync: (command, args, options) => nodeSpawnSync(command, args, options),
  env: process.env,
  log: (line) => console.error(line),
}

/**
 * Install scripts already attempted in this process, keyed by `install.js`
 * path. Repeated resolve calls must not re-run (and re-download) the binary.
 */
const attemptedInstalls = new Set<string>()

/** Test-only: forgets which install scripts this process already ran. */
export function resetFfmpegInstallAttempts(): void {
  attemptedInstalls.clear()
}

export function resolveFfmpegPath(deps: Partial<FfmpegPathDeps> = {}): string {
  const {
    ffmpegStatic: staticPath,
    existsSync,
    removeFile,
    spawnSync,
    env,
    log,
  } = {
    ...defaultDeps,
    ...deps,
  }

  const override = env.FFMPEG_BIN
  if (override !== undefined && override.length > 0) {
    return override
  }

  if (staticPath === null) {
    throw new Error(FFMPEG_UNSUPPORTED_PLATFORM_MESSAGE)
  }

  if (existsSync(staticPath)) {
    return staticPath
  }

  const installJs = join(dirname(staticPath), 'install.js')
  if (existsSync(installJs) && !attemptedInstalls.has(installJs)) {
    attemptedInstalls.add(installJs)
    log(
      "[screenci] ffmpeg binary missing (ffmpeg-static's install script was skipped); downloading it now."
    )
    const result = spawnSync(process.execPath, [installJs], {
      stdio: 'inherit',
    })
    if (result.error === undefined && result.status === 0) {
      if (existsSync(staticPath)) {
        return staticPath
      }
    } else {
      log(
        `[screenci] ffmpeg-static install failed: ${result.error?.message ?? `exit code ${String(result.status)}`}`
      )
      // install.js streams straight to the final path, so a failed download
      // can leave a truncated binary that would pass the existence check on
      // every later run. Remove it so the next run retries the download.
      try {
        removeFile(staticPath)
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  throw new Error(FFMPEG_MISSING_MESSAGE)
}
