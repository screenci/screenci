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

function assertValidSpeedMultiplier(multiplier: number): void {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error('speed() multiplier must be a finite number greater than 0')
  }
}

export function setActiveSpeedRecorder(recorder: IEventRecorder | null): void {
  setRuntimeHideRecorder(recorder)
}

/**
 * Editable metadata for a `speed` block. A numeric multiplier comes from
 * code and is marked explicit (a web edit shadows it with a warning); the
 * bare (`speed(fn)`) form is web-editable with a default multiplier of 1.
 * The stable identity slug comes from the `editId` option, stamped
 * automatically when missing.
 */
function buildSpeedEditableMeta(input: {
  multiplier: number
  locked: boolean
  editId?: string | undefined
}): EditableMeta | undefined {
  const identity = {
    kind: 'speed' as const,
    ...(input.editId !== undefined && { editId: input.editId }),
  }
  return buildEditableMeta({
    ...identity,
    schemaKind: 'speed',
    locked: input.locked,
    ...(input.locked && { lockedFields: ['multiplier'] }),
    defaults: { multiplier: input.multiplier },
    position: nextEditablePosition(editableIdentityKey(identity)),
  })
}

/**
 * Speeds up (or slows down) the recording inside `fn` at render time.
 *
 * Two forms:
 *
 * - `speed(3, fn)`: the multiplier comes from code and is locked against web
 *   edits.
 * - `speed(fn)`: web-editable block (the multiplier defaults to 1 until
 *   edited there), identified by its `editId` option (stamped automatically
 *   when missing).
 */
export async function speed(
  fn: () => Promise<void> | void,
  options?: TimelineBlockOptions
): Promise<void>
export async function speed(
  multiplier: number,
  fn: () => Promise<void> | void,
  options?: TimelineBlockOptions
): Promise<void>
export async function speed(
  first: number | (() => Promise<void> | void),
  second?: (() => Promise<void> | void) | TimelineBlockOptions,
  maybeOptions?: TimelineBlockOptions
): Promise<void> {
  const fn =
    typeof first === 'function'
      ? first
      : typeof second === 'function'
        ? second
        : undefined
  const options =
    typeof first === 'function'
      ? (second as TimelineBlockOptions | undefined)
      : maybeOptions
  if (fn === undefined) {
    throw new Error('speed() requires a callback function')
  }
  const delayMs = validateDelay('speed', options?.delay)

  const locked = typeof first === 'number'
  if (locked) assertValidSpeedMultiplier(first)

  const editable = buildSpeedEditableMeta({
    multiplier: locked ? first : 1,
    locked,
    editId: options?.editId,
  })
  // Web override for the editable forms; the multiplier defaults to 1 (no
  // speed change) until edited in the web editor.
  const effective = applyEditableOverride(editable)
  const multiplier =
    typeof effective.multiplier === 'number'
      ? effective.multiplier
      : locked
        ? first
        : 1
  assertValidSpeedMultiplier(multiplier)

  const recorder = getActiveHideRecorder()
  await runTimelineBlock({
    type: 'speed',
    recorder,
    emitStart: (activeRecorder) =>
      activeRecorder.addSpeedStart(multiplier, editable, ...delayArg(delayMs)),
    emitEnd: (activeRecorder) => activeRecorder.addSpeedEnd(),
    fn,
    multiplier,
  })
}
