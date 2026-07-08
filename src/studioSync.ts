/**
 * Studio option state fetched from the web editor: render options, record
 * options, and presence flags for content edits (narration, on-screen text,
 * audio, overlays). The editor is the source of truth for these values; render
 * options apply server-side, record options at record time. Phase 5 will add a
 * codify path that writes these into `video.renderOptions(...)` /
 * `video.recordOptions(...)` calls. Pure state type; the CLI wires in the
 * fetch.
 */

export interface StudioSyncVideo {
  renderOptions?: Record<string, unknown>
  recordOptions?: Record<string, unknown>
  content: {
    narration: boolean
    text: boolean
    audio: boolean
    assets: boolean
  }
}

export interface StudioSyncState {
  videos: Record<string, StudioSyncVideo>
}
