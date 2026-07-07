/**
 * Backend client for web-editor action-parameter overrides, behind an injected
 * interface so the CLI can be tested with fakes and so record keeps working
 * while the backend side is not implemented yet.
 *
 * The used parameter values (with explicit/default provenance) reach the
 * backend inside the uploaded `data.json` (`RecordingData.actionParams`); no
 * separate push is needed. When the backend endpoint ships, replace the stub
 * with a real fetch of `GET /cli/action-overrides?projectName=...` returning
 * `{ overrides: ActionOverridesByVideo }`.
 */
import type { ActionOverridesByVideo } from './actionParams.js'

export type ActionOverridesClient = {
  fetchActionOverrides(input: {
    apiUrl: string
    secret: string
    projectName: string
  }): Promise<ActionOverridesByVideo>
}

/** Stub used until the backend endpoint exists: no overrides. */
export const stubActionOverridesClient: ActionOverridesClient = {
  fetchActionOverrides: async () => ({}),
}
