/**
 * Applies a single editor codegen request to the test sources.
 *
 * The dev channel delivers one unified timeline-edit record (paramEdit,
 * mediaEdit, zoomEdit, gapSpanEdit, gapPointEdit, overlayDeclEdit or
 * renameEdit) addressed by editId. The record is written straight into the
 * `.screenci.ts` source through the same codemod pipeline `screenci sync`
 * uses; the call site is located via the editable entries of the video's kept
 * recording data. Throws when the edit cannot be applied, so the listener
 * reports the request failed and the editor reverts the optimistic value.
 */
import { planCodeSync } from './codeSync.js'
import type { TsModule } from './codemod.js'
import type { DevCodegenRequest } from './devListen.js'
import {
  splitTimelineEditsByVideo,
  type EditableSnapshot,
} from './editableSnapshot.js'

export type ApplyCodegenDeps = {
  ts: TsModule
  readFile: (path: string) => string | null
  writeFile: (path: string, content: string) => void
  /**
   * Editable entries per video (key, editId, defaults, source file), built
   * from the kept recording data. Used to locate call sites by editId.
   */
  editableSnapshot: EditableSnapshot
}

export function applyCodegenRequest(
  request: DevCodegenRequest,
  deps: ApplyCodegenDeps
): void {
  let record: unknown
  try {
    record = JSON.parse(request.editJson)
  } catch {
    throw new Error(`Edit "${request.editId}" carries invalid JSON`)
  }
  if (typeof record !== 'object' || record === null) {
    throw new Error(`Edit "${request.editId}" is not an edit record`)
  }

  const split = splitTimelineEditsByVideo({
    [request.videoName]: { version: 3, edits: [record] },
  })

  const plan = planCodeSync(
    {
      // The codegen path carries no web action-param state to diff; the
      // single record IS the change.
      comparison: { videos: [], snapshotEmpty: true },
      actionSnapshot: { version: 1, videos: {} },
      editableSnapshot: deps.editableSnapshot,
      editableOverrides: split.overrides,
      codifyEdits: split.codify,
      removedCodifyEdits: split.removedCodify,
      renames: split.renames,
      overlayDeclEdits: split.overlayDecls,
    },
    { ts: deps.ts, readFile: deps.readFile }
  )

  if (plan.unappliable.length > 0) {
    const reasons = plan.unappliable.map((item) => item.reason).join('; ')
    throw new Error(
      `Edit "${request.editId}" could not be applied to code: ${reasons}`
    )
  }

  for (const file of plan.files) {
    if (file.after !== file.before) deps.writeFile(file.path, file.after)
  }
}
