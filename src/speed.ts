import type { IEventRecorder } from './events.js'
import { setRuntimeHideRecorder } from './runtimeContext.js'
import { getActiveHideRecorder, runTimelineBlock } from './timelineBlock.js'

function assertValidSpeedMultiplier(multiplier: number): void {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error('speed() multiplier must be a finite number greater than 0')
  }
}

export function setActiveSpeedRecorder(recorder: IEventRecorder | null): void {
  setRuntimeHideRecorder(recorder)
}

export async function speed(
  multiplier: number,
  fn: () => Promise<void> | void
): Promise<void> {
  assertValidSpeedMultiplier(multiplier)
  const recorder = getActiveHideRecorder()
  await runTimelineBlock({
    type: 'speed',
    recorder,
    emitStart: (activeRecorder) => activeRecorder.addSpeedStart(multiplier),
    emitEnd: (activeRecorder) => activeRecorder.addSpeedEnd(),
    fn,
    multiplier,
  })
}
