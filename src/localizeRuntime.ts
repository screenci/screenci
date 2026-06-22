import { buildLocalizedNarrationCues, type NarrationCue } from './cue.js'
import type { NormalizedLocalize } from './localize.js'
import type { TextOverrides } from './runtimeMode.js'
import type { TopLevelVoiceConfig } from './voiceConfig.js'
import type { RenderOptions } from './types.js'
import type { StudioRenderOptionsSentinel } from './studio.js'
import { isStudioRenderOptions } from './studio.js'

/**
 * The config/global default narration voice from a recording's render options.
 * This is the lowest-priority entry in the voice cascade: the localize `voice`
 * (per-language) and per-cue `voice` override it. Studio render options carry no
 * voice here (Studio owns it at render).
 */
export function narrationVoiceConfigFromRenderOptions(
  renderOptions: RenderOptions | StudioRenderOptionsSentinel | undefined
): TopLevelVoiceConfig | undefined {
  if (renderOptions === undefined || isStudioRenderOptions(renderOptions)) {
    return undefined
  }
  return renderOptions.narration?.voice
}

/** Narration markers keyed by cue name. Markers carry timing, never text. */
export type NarrationMarkers = Record<string, NarrationCue>

/** Per-language text field values, keyed by field name. */
export type TextValues = Record<string, string | undefined>

/**
 * Build the `narration` marker object for a localized recording. Seeded cues
 * emit translations carrying the resolved voice + spoken text (filtered to the
 * active language by the recorder); Studio-managed cues emit studio cues whose
 * text is owned by Studio. The markers expose only timing, never the text.
 *
 * The narration voice is resolved per `(cue, language)`: per-cue `voice` →
 * localize `voiceByLang` → the config/global `defaultVoice` → a built-in voice.
 */
export function buildNarrationMarkers(
  localize: NormalizedLocalize | undefined,
  defaultVoice?: TopLevelVoiceConfig
): NarrationMarkers {
  if (!localize) return {}
  return buildLocalizedNarrationCues(
    localize.narration,
    localize.voiceByLang,
    defaultVoice
  )
}

/**
 * Resolve the `text` field values for the active language: a Studio override (if
 * present, from {@link parseTextOverrides}) wins over the code-declared seed.
 * Studio-managed text has no seed, so it resolves to the override or `undefined`
 * (an unresolved field holds the render until it is set in Studio).
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
    language !== undefined
      ? (text.seedByLang as Record<string, Record<string, string>>)[language]
      : undefined

  const values: TextValues = {}
  for (const field of text.fieldNames) {
    values[field] = override?.[field] ?? seed?.[field]
  }
  return values
}
