import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'

const ffmpegPath = ffmpegStatic as unknown as string | null

/**
 * Upper bound on the bytes we send as a voice-clone sample. ElevenLabs rejects
 * larger uploads ("a maximum of 11MB"); we shrink or reject before upload so a
 * failure surfaces here, at record time, rather than mid-render. Mirrors the
 * backend's MAX_CUSTOM_VOICE_SIZE_BYTES.
 */
export const MAX_VOICE_SAMPLE_BYTES = 11_000_000

// Containers that carry a video track. A voice clone only needs the audio, so
// for these we always strip to a small audio file before upload.
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi'])

export type ExtractedVoiceSample = {
  buffer: Buffer
  /** MIME type of the produced bytes. */
  contentType: string
  /** Extension (with leading dot) describing the produced bytes. */
  extension: string
}

/** Injectable side effects, so the extraction flow can be unit tested without a
 *  real ffmpeg binary or filesystem. */
export type VoiceSampleAudioDeps = {
  runFfmpeg: (args: string[]) => Promise<void>
  makeTempDir: (prefix: string) => Promise<string>
  readOutput: (path: string) => Promise<Buffer>
  removeDir: (path: string) => Promise<void>
}

function defaultRunFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ffmpegPath === null) {
      reject(
        new Error(
          '[screenci] ffmpeg binary not found; cannot extract audio from the voice sample.'
        )
      )
      return
    }
    const child = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          `[screenci] ffmpeg exited with code ${String(code)} while extracting voice-sample audio.\n${stderr.slice(-2000)}`
        )
      )
    })
  })
}

const defaultDeps: VoiceSampleAudioDeps = {
  runFfmpeg: defaultRunFfmpeg,
  makeTempDir: (prefix) => mkdtemp(prefix),
  readOutput: (path) => readFile(path),
  removeDir: (path) => rm(path, { recursive: true, force: true }),
}

/**
 * Returns an extracted/transcoded audio sample when the source is a video
 * container or exceeds {@link MAX_VOICE_SAMPLE_BYTES}, or `null` when the source
 * is already an audio file within the limit (upload it unchanged).
 *
 * Extraction strips any video track and transcodes to MP3 at 192 kbps, the
 * format ElevenLabs recommends for cloning. A 20 MB screen recording becomes a
 * few hundred KB of audio. If the result is still over the limit (e.g. a very
 * long sample), this throws so the CLI can fail fast with a clear message.
 */
export async function maybeExtractVoiceSampleAudio(
  sourcePath: string,
  sourceByteLength: number,
  deps: Partial<VoiceSampleAudioDeps> = {}
): Promise<ExtractedVoiceSample | null> {
  const ext = extname(sourcePath).toLowerCase()
  const isVideo = VIDEO_EXTENSIONS.has(ext)
  const tooLarge = sourceByteLength > MAX_VOICE_SAMPLE_BYTES
  if (!isVideo && !tooLarge) return null

  const { runFfmpeg, makeTempDir, readOutput, removeDir } = {
    ...defaultDeps,
    ...deps,
  }

  const dir = await makeTempDir(join(tmpdir(), 'screenci-voice-'))
  const outputPath = join(dir, 'voice-sample.mp3')
  try {
    // The clone cache is keyed by the SHA-256 of these uploaded bytes, so the
    // output must be byte-reproducible: the same source must always yield the
    // same MP3, otherwise the voice gets re-cloned on every run and the clone
    // service accumulates duplicates. `-bitexact` stops ffmpeg embedding its
    // version string, `-map_metadata -1` drops copied source tags (timestamps,
    // device info), and `-map 0:a:0` at a fixed CBR bitrate makes the encode
    // deterministic. The hash then only moves if the bundled encoder itself
    // changes its output (e.g. an ffmpeg-static bump), which re-clones once.
    await runFfmpeg([
      '-y',
      '-bitexact',
      '-i',
      sourcePath,
      '-vn',
      '-map',
      '0:a:0',
      '-map_metadata',
      '-1',
      '-acodec',
      'libmp3lame',
      '-b:a',
      '192k',
      '-bitexact',
      outputPath,
    ])
    const buffer = await readOutput(outputPath)
    if (buffer.byteLength > MAX_VOICE_SAMPLE_BYTES) {
      const limitMb = Math.floor(MAX_VOICE_SAMPLE_BYTES / (1000 * 1000))
      throw new Error(
        `[screenci] Voice sample audio is still too large after extraction (${buffer.byteLength} bytes; the limit is ${limitMb} MB). Use a shorter sample (about 1-2 minutes of clean speech is ideal).`
      )
    }
    return { buffer, contentType: 'audio/mpeg', extension: '.mp3' }
  } finally {
    await removeDir(dir).catch(() => {})
  }
}
