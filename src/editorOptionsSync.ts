/**
 * Editor option state fetched from the web editor: render options, record
 * options, and presence flags for content edits (narration, on-screen text,
 * audio, overlays). Code is the source of truth: `screenci sync` codifies these
 * into `video.renderOptions(...)` / `video.recordOptions(...)` calls. Render
 * options apply server-side, record options at record time. Pure state type;
 * the CLI wires in the fetch.
 */

export interface EditorOptionsSyncVideo {
  renderOptions?: Record<string, unknown>
  recordOptions?: Record<string, unknown>
  content: {
    narration: boolean
    text: boolean
    audio: boolean
    assets: boolean
  }
}

export interface EditorOptionsSyncState {
  videos: Record<string, EditorOptionsSyncVideo>
}
