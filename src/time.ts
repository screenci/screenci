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
import { delayArg, validateDelay } from './overlayUpdates.js'
import type { TimelineBlockOptions } from './hide.js'

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
 * (explicit; a web edit shadows it with a warning). The stable identity slug
 * comes from the `editId` option, stamped automatically when missing.
 */
function buildTimeEditableMeta(input: {
  durationMs: number
  editId?: string | undefined
}): EditableMeta | undefined {
  const identity = {
    kind: 'time' as const,
    ...(input.editId !== undefined && { editId: input.editId }),
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
 * (compressing or stretching it): `time(1000, fn)`.
 *
 * The duration is web-editable: an editor override applies at the next
 * record and shadows the code value with a warning. The block's stable
 * identity slug comes from the `editId` option (stamped automatically when
 * missing).
 */
export async function time(
  durationMs: number,
  fn: () => Promise<void> | void,
  options?: TimelineBlockOptions
): Promise<void> {
  const codeDurationMs = durationMs
  if (typeof fn !== 'function') {
    throw new Error('time() requires a callback function')
  }
  assertValidTimeDuration(codeDurationMs)
  const delayMs = validateDelay('time', options?.delay)
  const name = options?.editId

  const editable = buildTimeEditableMeta({
    durationMs: codeDurationMs,
    editId: options?.editId,
  })
  const effective = applyEditableOverride(editable)
  const effectiveDurationMs =
    typeof effective.durationMs === 'number'
      ? effective.durationMs
      : codeDurationMs
  assertValidTimeDuration(effectiveDurationMs)

  const recorder = getActiveHideRecorder()
  await runTimelineBlock({
    type: 'time',
    recorder,
    emitStart: (activeRecorder) =>
      activeRecorder.addTimeStart(
        effectiveDurationMs,
        editable,
        name,
        ...delayArg(delayMs)
      ),
    emitEnd: (activeRecorder) => activeRecorder.addTimeEnd(),
    fn,
    durationMs: effectiveDurationMs,
  })
}
