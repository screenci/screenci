import {
  createNarration,
  createStudioNarration,
  type NarrationCue,
} from './cue.js'
import { voices } from './voices.js'
import type { NormalizedLocalize } from './localize.js'
import type { TextOverrides } from './runtimeMode.js'
import type { NarrationVoiceConfig } from './voiceConfig.js'
import type { RenderOptions } from './types.js'
import type { StudioRenderOptionsSentinel } from './studio.js'
import { isStudioRenderOptions } from './studio.js'

/**
 * Extract the narration voice config (default + per-language) from a recording's
 * render options. Voice is a render option (`renderOptions.narration`); Studio
 * render options carry no voice here (Studio owns it at render).
 */
export function narrationVoiceConfigFromRenderOptions(
  renderOptions: RenderOptions | StudioRenderOptionsSentinel | undefined
): NarrationVoiceConfig | undefined {
  if (renderOptions === undefined || isStudioRenderOptions(renderOptions)) {
    return undefined
  }
  const narration = renderOptions.narration
  if (!narration) return undefined
  return {
    ...(narration.voice !== undefined && { voice: narration.voice }),
    ...(narration.voices !== undefined && { voices: narration.voices }),
  }
}

/** Narration markers keyed by cue name. Markers carry timing, never text. */
export type NarrationMarkers = Record<string, NarrationCue>

/** Per-language text field values, keyed by field name. */
export type TextValues = Record<string, string | undefined>

/**
 * Build the `narration` marker object for a localized recording. Seeded
 * narration emits cue events carrying the seed translations (filtered to the
 * active language by the recorder); name-only narration emits studio cues whose
 * text is owned by Studio. The markers expose only timing, never the text.
 *
 * Voice is not part of the content: it comes from `renderOptions.narration`
 * (`voice` default + per-language `voices`), defaulting to a built-in voice.
 * Per-cue `cueVoices` is not applied here yet.
 */
export function buildNarrationMarkers(
  localize: NormalizedLocalize | undefined,
  voiceConfig?: NarrationVoiceConfig
): NarrationMarkers {
  const narration = localize?.narration
  if (!narration) return {}

  if (narration.kind === 'studio') {
    if (narration.cueNames.length === 0) return {}
    return createStudioNarration(
      ...(narration.cueNames as [string, ...string[]])
    )
  }

  const input: Record<string, unknown> = {
    voice: voiceConfig?.voice ?? { name: voices.Sophie },
  }
  for (const [lang, cues] of Object.entries(narration.seed)) {
    const langVoice = voiceConfig?.voices?.[lang]
    input[lang] = langVoice ? { voice: langVoice, ...cues } : cues
  }

  return createNarration(
    input as Parameters<typeof createNarration>[0]
  ) as NarrationMarkers
}

/**
 * Resolve the `text` field values for the active language: a Studio override (if
 * present, from {@link parseTextOverrides}) wins over the code-declared seed.
 * Name-only (Studio-managed) text has no seed, so it resolves to the override or
 * `undefined` (an unresolved field holds the render until it is set in Studio).
 */
export function buildTextValues(
  localize: NormalizedLocalize | undefined,
  language: string | undefined,
  overrides?: TextOverrides | null
): TextValues {
  const text = localize?.text
  if (!text) return {}

  const override = language !== undefined ? overrides?.[language] : undefined
  const seed =
    text.kind === 'seeded'
      ? language !== undefined
        ? (text.seed as Record<string, Record<string, string>>)[language]
        : undefined
      : undefined

  const values: TextValues = {}
  for (const field of text.fieldNames) {
    values[field] = override?.[field] ?? seed?.[field]
  }
  return values
}
