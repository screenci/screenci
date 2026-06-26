/**
 * Integration tests for screen audio capture.
 *
 * These tests spawn a real ffmpeg process. They are skipped unless
 * SCREENCI_TEST_AUDIO_FORMAT is set, so they never run in the normal unit test
 * suite.
 *
 * The CI audio-capture job uses ffmpeg's built-in lavfi null source on all
 * platforms. This avoids OS-level audio device setup while still exercising the
 * full capture lifecycle: spawn, write WAV, graceful stop, read file, SHA-256
 * hash. Platform-specific arg resolution (pulse, avfoundation, wasapi) is
 * covered by the unit tests in screenAudio.spec.ts.
 *
 * Run locally on any OS (synthetic null source, no hardware needed):
 *   SCREENCI_TEST_AUDIO_FORMAT=lavfi SCREENCI_TEST_AUDIO_DEVICE=anullsrc npm run test:run -- screenAudio.integration
 *
 * Run against a real device (Linux example):
 *   SCREENCI_TEST_AUDIO_FORMAT=pulse SCREENCI_TEST_AUDIO_DEVICE=default.monitor npm run test:run -- screenAudio.integration
 */
import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { startScreenAudioCapture, type ScreenAudioDeps } from './screenAudio.js'
import { spawn } from 'child_process'
import { readFile } from 'fs/promises'
import ffmpegStatic from 'ffmpeg-static'

const ffmpegPath = (ffmpegStatic as unknown as string | null) ?? 'ffmpeg'

const AUDIO_FORMAT = process.env.SCREENCI_TEST_AUDIO_FORMAT
const AUDIO_DEVICE = process.env.SCREENCI_TEST_AUDIO_DEVICE

describe.skipIf(!AUDIO_FORMAT)('startScreenAudioCapture (integration)', () => {
  it('captures audio to a non-empty WAV file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'screenci-audio-integration-'))
    const outputPath = join(dir, 'capture.wav')
    try {
      // Override platform args with the CI-supplied format/device so the test
      // works on any OS without real hardware (lavfi null source in CI).
      const deps: ScreenAudioDeps = {
        spawn: vi
          .fn()
          .mockImplementation((_cmd: string, args: string[], opts: object) => {
            const overridden = args.map((a) => {
              if (a === args[args.indexOf('-f') + 1]) return AUDIO_FORMAT!
              if (a === args[args.indexOf('-i') + 1]) return AUDIO_DEVICE ?? ''
              return a
            })
            return spawn(ffmpegPath, overridden, opts)
          }) as unknown as typeof spawn,
        readFile,
      }

      const capture = startScreenAudioCapture(outputPath, deps)

      // Capture for 800ms to ensure at least a few frames are written.
      await new Promise<void>((resolve) => setTimeout(resolve, 800))

      const result = await capture.stop()

      expect(result.path).toBe(outputPath)
      expect(result.fileHash).toMatch(/^[0-9a-f]{64}$/)

      const info = await stat(outputPath)
      // A valid PCM WAV with 800ms of audio (44100 Hz, 16-bit, mono) is
      // roughly 70 KB. Accept anything above 1 KB to tolerate low sample
      // rates or stereo vs mono variation.
      expect(info.size).toBeGreaterThan(1024)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 10_000)
})
