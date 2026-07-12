/**
 * Applies a single editor codegen request to the test sources.
 *
 * The dev channel delivers one unified timeline-edit record (paramEdit,
 * mediaEdit, zoomEdit, gapSpanEdit, gapPointEdit, overlayDeclEdit,
 * optionsEdit, narrationEdit or renameEdit). The record is written straight
 * into the
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

/**
 * Guard for the codegen path: resolve the TypeScript module through the
 * injected loader, throwing an actionable error when it is unavailable (the
 * dev listener reports the message back to the editor).
 */
export function requireTypescriptForCodegen(
  loadTs: (projectDir: string) => TsModule | null,
  projectDir: string
): TsModule {
  const ts = loadTs(projectDir)
  if (ts === null) {
    throw new Error(
      'TypeScript is not available; install it to enable editor codegen'
    )
  }
  return ts
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
    [request.videoName]: { version: 4, edits: [record] },
  })

  const editorOptionsVideo = split.studioOptions[request.videoName]
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
      ...(editorOptionsVideo !== undefined && {
        editorOptionsSync: {
          videos: {
            [request.videoName]: {
              ...editorOptionsVideo,
              content: {
                narration: false,
                text: false,
                audio: false,
                assets: false,
              },
            },
          },
        },
      }),
      narrationEdits: split.narrationEdits,
      valuesEdits: split.valuesEdits,
      languagesEdits: split.languagesEdits,
      editorMediaEdits: split.editorMediaEdits,
    },
    { ts: deps.ts, readFile: deps.readFile }
  )

  if (plan.unappliable.length > 0) {
    const reasons = plan.unappliable
      .map((item) => `[${item.reason}] ${item.message}`)
      .join('; ')
    throw new Error(
      `Edit "${request.editId}" could not be applied to code: ${reasons}`
    )
  }

  for (const file of plan.files) {
    if (file.after !== file.before) deps.writeFile(file.path, file.after)
  }
}
