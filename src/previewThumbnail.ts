import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'path'
import { resolveFfmpegPath } from './ffmpegPath.js'

/** File name of the preview thumbnail written beside a recording's `data.json`. */
export const PREVIEW_THUMBNAIL_FILE_NAME = 'preview-thumbnail.jpg'

/** True when the current run is a preview-only record pass (no render). */
export function isPreviewOnlyRun(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env['SCREENCI_PREVIEW_ONLY'] === '1'
}

/** Fraction of the recording at which the thumbnail frame is taken. */
export const PREVIEW_THUMBNAIL_POSITION = 0.1

/** Parses `Duration: hh:mm:ss.cc` from `ffmpeg -i` stderr, in seconds. */
export function parseFfmpegDurationSeconds(stderr: string): number | null {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr)
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

export type PreviewThumbnailDeps = {
  /** Runs ffmpeg and resolves its stderr, whatever the exit code. */
  runFfmpeg: (args: string[]) => Promise<string>
  /** Whether a non-empty file exists at `path`. */
  hasOutput: (path: string) => Promise<boolean>
}

function frameArgs(input: string, output: string, atSeconds: number) {
  return [
    '-ss',
    atSeconds.toFixed(3),
    '-i',
    input,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    '-y',
    output,
  ]
}

/**
 * Best-effort: write the frame at 10% of `recording.mp4` as the preview's
 * thumbnail, or the first frame when the video is a single frame (or the seek
 * lands past the end). Never throws. Returns the written path, or null.
 */
export async function extractPreviewThumbnail(
  recordingDir: string,
  deps: PreviewThumbnailDeps
): Promise<string | null> {
  const input = join(recordingDir, 'recording.mp4')
  const output = join(recordingDir, PREVIEW_THUMBNAIL_FILE_NAME)
  try {
    const durationSeconds =
      parseFfmpegDurationSeconds(await deps.runFfmpeg(['-i', input])) ?? 0
    const at = durationSeconds * PREVIEW_THUMBNAIL_POSITION
    if (at > 0) {
      await deps.runFfmpeg(frameArgs(input, output, at))
      if (await deps.hasOutput(output)) return output
    }
    await deps.runFfmpeg(frameArgs(input, output, 0))
    return (await deps.hasOutput(output)) ? output : null
  } catch {
    // A missing thumbnail only means the app keeps its placeholder.
    return null
  }
}

/**
 * Real ffmpeg and filesystem side effects. The executable is resolved lazily
 * per spawn (via `resolveFfmpegPath`, injectable for tests) so a skipped
 * `ffmpeg-static` install can self-heal on first use.
 */
export function createPreviewThumbnailDeps(
  resolveFfmpeg: () => string = resolveFfmpegPath
): PreviewThumbnailDeps {
  return {
    runFfmpeg: (args) =>
      new Promise((resolve, reject) => {
        let ffmpegPath: string
        try {
          ffmpegPath = resolveFfmpeg()
        } catch (error) {
          reject(error)
          return
        }
        const child = spawn(ffmpegPath, ['-hide_banner', ...args], {
          stdio: ['ignore', 'ignore', 'pipe'],
        })
        let stderr = ''
        child.stderr?.on('data', (chunk) => {
          stderr += chunk.toString()
        })
        child.on('error', reject)
        child.on('close', () => resolve(stderr))
      }),
    hasOutput: async (path) => {
      try {
        return (await stat(path)).size > 0
      } catch {
        return false
      }
    },
  }
}

/** Default side effects: bundled `ffmpeg-static` (self-healing) plus the real filesystem. */
export const defaultPreviewThumbnailDeps: PreviewThumbnailDeps =
  createPreviewThumbnailDeps()

export type UploadPreviewThumbnailDeps = {
  readFile: (path: string) => Promise<Buffer>
  fetch: typeof fetch
}

/**
 * Best-effort: upload a captured preview thumbnail for `recordingId`. Returns
 * false (never throws) when the file is missing or the upload fails, since the
 * recording itself already uploaded fine.
 */
export async function uploadPreviewThumbnail(
  params: {
    apiUrl: string
    recordingId: string
    recordingDir: string
    credential: { header: string; value: string }
  },
  deps: UploadPreviewThumbnailDeps
): Promise<boolean> {
  let bytes: Buffer
  try {
    bytes = await deps.readFile(
      join(params.recordingDir, PREVIEW_THUMBNAIL_FILE_NAME)
    )
  } catch {
    return false
  }
  try {
    const res = await deps.fetch(
      `${params.apiUrl}/cli/upload/${params.recordingId}/preview-thumbnail`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/jpeg',
          [params.credential.header]: params.credential.value,
        },
        body: new Uint8Array(bytes),
      }
    )
    return res.ok
  } catch {
    return false
  }
}
