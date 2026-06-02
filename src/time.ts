import type { IEventRecorder } from './events.js'
import { setRuntimeHideRecorder } from './runtimeContext.js'
import { getActiveHideRecorder, runTimelineBlock } from './timelineBlock.js'

function assertValidTimeDuration(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error(
      'time() durationMs must be a finite number greater than or equal to 0'
    )
  }
}

export function setActiveTimeRecorder(recorder: IEventRecorder | null): void {
  setRuntimeHideRecorder(recorder)
}

export async function time(
  durationMs: number,
  fn: () => Promise<void> | void
): Promise<void> {
  assertValidTimeDuration(durationMs)
  const recorder = getActiveHideRecorder()
  await runTimelineBlock({
    type: 'time',
    recorder,
    emitStart: (activeRecorder) => activeRecorder.addTimeStart(durationMs),
    emitEnd: (activeRecorder) => activeRecorder.addTimeEnd(),
    fn,
    durationMs,
  })
}
