import type { IEventRecorder } from './events.js'
import {
  nextEditablePosition,
  setRuntimeHideRecorder,
} from './runtimeContext.js'
import { getActiveHideRecorder, runTimelineBlock } from './timelineBlock.js'
import {
  buildEditableMeta,
  editableIdentityKey,
  type EditableMeta,
} from './editableDescriptor.js'
import { applyEditableOverride } from './editableRuntime.js'

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

/**
 * Editable metadata for a `time` block. The target duration comes from code
 * (explicit; a web edit shadows it with a warning). An optional name makes
 * the identity robust across re-records, like `speed('name', fn)`.
 */
function buildTimeEditableMeta(input: {
  durationMs: number
  name?: string | undefined
}): EditableMeta | undefined {
  const identity = {
    kind: 'time' as const,
    ...(input.name !== undefined && { name: input.name }),
  }
  return buildEditableMeta({
    ...identity,
    schemaKind: 'time',
    locked: true,
    lockedFields: ['durationMs'],
    defaults: { durationMs: input.durationMs },
    position: nextEditablePosition(editableIdentityKey(identity)),
  })
}

/**
 * Remaps the wrapped section to exactly `durationMs` at render time
 * (compressing or stretching it). Two forms:
 *
 * - `time(1000, fn)`
 * - `time('name', 1000, fn)`: names the block on the editor timeline.
 *
 * The duration is web-editable: an editor override applies at the next
 * record and shadows the code value with a warning.
 */
export async function time(
  durationMs: number,
  fn: () => Promise<void> | void
): Promise<void>
export async function time(
  name: string,
  durationMs: number,
  fn: () => Promise<void> | void
): Promise<void>
export async function time(
  first: number | string,
  second: number | (() => Promise<void> | void),
  maybeFn?: () => Promise<void> | void
): Promise<void> {
  const name = typeof first === 'string' ? first : undefined
  const codeDurationMs = typeof first === 'number' ? first : (second as number)
  const fn = typeof second === 'function' ? second : maybeFn
  if (fn === undefined) {
    throw new Error('time() requires a callback function')
  }
  assertValidTimeDuration(codeDurationMs)

  const editable = buildTimeEditableMeta({ durationMs: codeDurationMs, name })
  const effective = applyEditableOverride(editable)
  const durationMs =
    typeof effective.durationMs === 'number'
      ? effective.durationMs
      : codeDurationMs
  assertValidTimeDuration(durationMs)

  const recorder = getActiveHideRecorder()
  await runTimelineBlock({
    type: 'time',
    recorder,
    emitStart: (activeRecorder) =>
      activeRecorder.addTimeStart(durationMs, editable, name),
    emitEnd: (activeRecorder) => activeRecorder.addTimeEnd(),
    fn,
    durationMs,
  })
}
