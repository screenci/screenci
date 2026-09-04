/**
 * Effective values of editable actions at runtime. Code is the single source
 * of truth: the web editor stores its edits server-side and applies them when
 * rendering, so a recording always runs with the code-declared values;
 * nothing is overridden at record time.
 */
import type { EditableMeta } from './editableDescriptor.js'

/**
 * The values an editable action runs with: its effective defaults straight
 * from code (explicit call-site values merged over package defaults by the
 * instrumentation that built `meta`).
 */
export function applyEditableOverride(
  meta: EditableMeta | undefined
): Record<string, unknown> {
  if (meta === undefined) return {}
  return { ...meta.defaults }
}
