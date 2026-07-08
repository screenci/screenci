/**
 * Turns the web editor's Studio option overrides (render options, record
 * options) and content edits (narration, on-screen text, audio, overlays) into
 * an agent-ready sync prompt, so `screenci sync-prompt` can codify them into the
 * .screenci scripts. The editor is the source of truth for these values; render
 * options are applied server-side, but mirroring them in code keeps the scripts
 * self-describing. Content edits are surfaced as presence notes only, never
 * dumped (they can be large media/text). Pure; the CLI wires in the fetch.
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

/** Flatten a nested options object into `dot.path -> leaf value` pairs. Arrays
 *  and null are treated as leaf values (set wholesale). */
function flattenLeaves(
  value: unknown,
  prefix: string,
  out: Array<{ path: string; value: unknown }>
): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    out.push({ path: prefix, value })
    return
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    flattenLeaves(child, prefix === '' ? key : `${prefix}.${key}`, out)
  }
}

/** Human directive for the content edits the editor holds for a video. */
const CONTENT_NOTES: Record<keyof StudioSyncVideo['content'], string> = {
  narration:
    "holds narration edits: keep them in the editor or codify into the script's narration blocks",
  text: "holds on-screen text (localize) edits: codify into the script's localized text",
  audio: "holds background audio edits: codify into the script's audio config",
  assets: "holds overlay edits: codify into the script's overlays",
}

/**
 * Build the Studio option sync section. Returns `null` when no video has any
 * option override or content edit. Emits SET directives for each render/record
 * option leaf and a NOTE per content field the editor holds.
 */
export function buildStudioSyncPrompt(
  state: StudioSyncState,
  projectName: string
): string | null {
  const sections: string[] = []
  for (const [videoName, video] of Object.entries(state.videos).sort(
    ([a], [b]) => a.localeCompare(b)
  )) {
    const lines: string[] = []
    const renderLeaves: Array<{ path: string; value: unknown }> = []
    flattenLeaves(video.renderOptions ?? {}, '', renderLeaves)
    for (const leaf of renderLeaves) {
      lines.push(
        `- SET \`renderOptions.${leaf.path}\` to ${JSON.stringify(leaf.value)} ` +
          `(in the config's render options or this video's render options).`
      )
    }
    const recordLeaves: Array<{ path: string; value: unknown }> = []
    flattenLeaves(video.recordOptions ?? {}, '', recordLeaves)
    for (const leaf of recordLeaves) {
      lines.push(
        `- SET \`recordOptions.${leaf.path}\` to ${JSON.stringify(leaf.value)} ` +
          `(in the config's record options). Applied at record time, so ` +
          `re-record after codifying.`
      )
    }
    for (const field of Object.keys(video.content) as Array<
      keyof StudioSyncVideo['content']
    >) {
      if (video.content[field]) {
        lines.push(`- NOTE: the editor ${CONTENT_NOTES[field]}.`)
      }
    }
    if (lines.length === 0) continue
    sections.push([`## Video: ${videoName}`, ...lines].join('\n'))
  }

  if (sections.length === 0) return null

  return [
    `Mirror the ScreenCI project "${projectName}" Studio option overrides into ` +
      `the .screenci scripts. For each SET item, set that option in the config ` +
      `(\`defineConfig\`) or on the video. NOTE items are content edits the ` +
      `editor holds; leave them in the editor or codify them as indicated.`,
    ...sections,
  ].join('\n\n')
}
