import type { IEventRecorder, SleepReason } from './events.js'
import { resolveRecordingTimingDuration } from './runtimeMode.js'

/**
 * Performs an artificial recording sleep and records it as a `sleep` event so
 * the renderer knows the span carries no real content. The requested duration
 * goes through recording-timing scaling first; when scaling collapses it to
 * zero (screenshots, disabled timings) nothing is slept or recorded.
 *
 * The blocking `sleepFn` is injected by the caller so tests can stub it.
 */
export function performRecordedSleep(
  recorder: IEventRecorder,
  requestedMs: number,
  reason: SleepReason,
  sleepFn: (ms: number) => void
): void {
  const durationMs = resolveRecordingTimingDuration(requestedMs)
  if (durationMs <= 0) return
  sleepFn(durationMs)
  recorder.addSleep(durationMs, reason)
}
