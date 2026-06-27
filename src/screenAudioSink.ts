import { execFile as nodeExecFile } from 'child_process'
import { promisify } from 'util'
import { SCREEN_AUDIO_DOCS_URL } from './screenAudio.js'

const execFileAsync = promisify(nodeExecFile)

/**
 * A dedicated PulseAudio/PipeWire null sink created for one recording worker.
 * The worker's browser is routed into `sinkName` (so its audio is silent on the
 * host and isolated from other apps), and the recorder captures `monitorSource`.
 */
export type NullSink = {
  /** `pactl` module id, used to unload the sink on teardown. */
  moduleId: string
  /** Sink name the browser plays into (via `PULSE_SINK`). */
  sinkName: string
  /** Monitor source the recorder captures (`<sinkName>.monitor`). */
  monitorSource: string
}

/** @internal - injected in tests */
export type SinkDeps = {
  run: (cmd: string, args: string[]) => Promise<{ stdout: string }>
}

const defaultDeps: SinkDeps = {
  run: (cmd, args) => execFileAsync(cmd, args),
}

/**
 * Deterministic, per-process sink name. Each Playwright worker is its own
 * process with a unique pid, so this gives one sink per worker that is trivial
 * to clean up and cannot collide with a concurrent worker.
 */
export function workerSinkName(pid: number = process.pid): string {
  return `screenci_${pid}`
}

/**
 * Creates a null sink via `pactl load-module module-null-sink`. Returns the
 * parsed module id and sink/monitor names, or `null` when `pactl` is missing or
 * the command fails (callers fall back to the default device and warn).
 */
export async function createNullSink(
  name: string = workerSinkName(),
  deps: SinkDeps = defaultDeps
): Promise<NullSink | null> {
  try {
    const { stdout } = await deps.run('pactl', [
      'load-module',
      'module-null-sink',
      `sink_name=${name}`,
      `sink_properties=device.description=${name}`,
    ])
    const moduleId = stdout.trim()
    if (!/^\d+$/.test(moduleId)) {
      return null
    }
    return { moduleId, sinkName: name, monitorSource: `${name}.monitor` }
  } catch {
    return null
  }
}

/**
 * Verifies that `pulseaudio` and `pactl` (pulseaudio-utils) are installed and
 * in PATH. Throws immediately with an actionable message if either is missing,
 * so callers fail fast rather than silently falling back to the default device.
 */
export async function assertPulseAudioAvailable(
  deps: SinkDeps = defaultDeps
): Promise<void> {
  for (const [bin, pkg] of [
    ['pulseaudio', 'pulseaudio'] as const,
    ['pactl', 'pulseaudio-utils'] as const,
  ]) {
    try {
      await deps.run(bin, ['--version'])
    } catch {
      throw new Error(
        `[screenci] captureAudio: "${bin}" is not installed or not in PATH. ` +
          `Install the "${pkg}" package and try again. ` +
          `See ${SCREEN_AUDIO_DOCS_URL} for setup instructions.`
      )
    }
  }
}

/** Unloads a previously created null sink. Best effort: never throws. */
export async function unloadNullSink(
  sink: NullSink,
  deps: SinkDeps = defaultDeps
): Promise<void> {
  try {
    await deps.run('pactl', ['unload-module', sink.moduleId])
  } catch {
    // Best effort: the server may already be gone (e.g. on shutdown).
  }
}
