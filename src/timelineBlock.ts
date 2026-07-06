import type { IEventRecorder } from './events.js'
import { resolveRecordingTimingDuration } from './runtimeMode.js'
import {
  getRuntimeHideRecorder,
  getRuntimeTimelineBlocks,
  hasRuntimeTimelineBlock,
  popRuntimeTimelineBlock,
  pushRuntimeTimelineBlock,
  type TimelineBlockType,
} from './runtimeContext.js'

export const POST_HIDE_PAUSE = 350

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, resolveRecordingTimingDuration(ms))
  )
}

type TimelineBlockRunOptions = {
  type: TimelineBlockType
  recorder: IEventRecorder
  emitStart: (recorder: IEventRecorder) => void
  emitEnd: (recorder: IEventRecorder) => void
  fn: () => Promise<void> | void
  multiplier?: number
  durationMs?: number
}

export async function runTimelineBlock({
  type,
  recorder,
  emitStart,
  emitEnd,
  fn,
  multiplier,
  durationMs,
}: TimelineBlockRunOptions): Promise<void> {
  assertTimelineBlockNesting(type)
  pushRuntimeTimelineBlock({
    type,
    ...(multiplier !== undefined && { multiplier }),
    ...(durationMs !== undefined && { durationMs }),
  })
  emitStart(recorder)
  try {
    await fn()
    if (type === 'hide') {
      await sleep(POST_HIDE_PAUSE)
    }
  } finally {
    try {
      popRuntimeTimelineBlock(type)
    } finally {
      emitEnd(recorder)
    }
  }
}

export function getActiveHideRecorder(): IEventRecorder {
  return getRuntimeHideRecorder()
}

export function isInsideHide(): boolean {
  return hasRuntimeTimelineBlock('hide')
}

export function isInsideTime(): boolean {
  return hasRuntimeTimelineBlock('time')
}

function assertTimelineBlockNesting(type: TimelineBlockType): void {
  const activeBlocks = getRuntimeTimelineBlocks()
  const activeTop = activeBlocks[activeBlocks.length - 1]

  if (activeTop === undefined) {
    return
  }

  if (type === 'hide') {
    if (activeTop.type === 'hide') {
      throw new Error('Cannot nest hide() calls')
    }
    return
  }

  throw new Error(
    `${type}() cannot be nested inside ${activeTop.type}(); only hide() inside speed() or time() is supported`
  )
}
