import {
  buildLocalizedNarrationCues,
  buildStudioNarrationCues,
  type NarrationCue,
} from './cue.js'
import type { NormalizedLocalize } from './localize.js'
import type { TextOverrides } from './runtimeMode.js'
import type { TopLevelVoiceConfig } from './voiceConfig.js'
import type { RenderOptions } from './types.js'

/**
 * The config/global default narration voice from a recording's render options.
 * This is the lowest-priority entry in the voice cascade: the localize `voice`
 * (per-language) and per-cue `voice` override it. When render options are
 * deferred to Studio (`video.studio({ renderOptions: true })`) there is no code
 * voice here (Studio owns it at render).
 */
export function narrationVoiceConfigFromRenderOptions(
  renderOptions: RenderOptions | undefined,
  studioRenderOptions: boolean
): TopLevelVoiceConfig | undefined {
  if (studioRenderOptions || renderOptions === undefined) {
    return undefined
  }
  return renderOptions.narration?.voice
}

/** Narration markers keyed by cue name. Markers carry timing, never text. */
export type NarrationMarkers = Record<string, NarrationCue>

/** Per-language text field values, keyed by field name. */
export type TextValues = Record<string, string>

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
  defaultVoice?: TopLevelVoiceConfig,
  studioNarration: readonly string[] = []
): NarrationMarkers {
  const seeded = localize
    ? buildLocalizedNarrationCues(
        localize.narration,
        localize.voiceByLang,
        defaultVoice
      )
    : {}
  if (studioNarration.length === 0) return seeded
  return { ...seeded, ...buildStudioNarrationCues(studioNarration) }
}

/**
 * Resolve the `text` field values for the active language: a Studio override (if
 * present, from {@link parseTextOverrides}) wins over the code-declared seed.
 * A Studio-managed field has no seed, so until it is set in Studio it resolves
 * to the empty string (the recording still succeeds, and Studio learns the field
 * from the emitted declaration and flags it as needing input).
 */
export function buildTextValues(
  localize: NormalizedLocalize | undefined,
  language: string | undefined,
  overrides?: TextOverrides | null,
  studioText: readonly string[] = []
): TextValues {
  const text = localize?.text
  const fieldNames = [...(text?.fieldNames ?? []), ...studioText]
  if (fieldNames.length === 0) return {}

  const override = language !== undefined ? overrides?.[language] : undefined
  const seed =
    language !== undefined && text
      ? (text.seedByLang as Record<string, Record<string, string>>)[language]
      : undefined

  const values: TextValues = {}
  for (const field of fieldNames) {
    values[field] = override?.[field] ?? seed?.[field] ?? ''
  }
  return values
}

/** A localized text declaration emitted to the backend at recording start. */
export type TextDeclaration = {
  /** Every field name (seeded then Studio-managed), in declared order. */
  fields: string[]
  /** Studio-managed field names (declared via `studio.text`, no code seed). */
  studioFields: string[]
  /** Code seeds keyed `{ [language]: { [field]: value } }`. Omitted when empty. */
  seed?: Record<string, Record<string, string>>
}

/**
 * Build the declaration of `text` fields to emit at recording start so the
 * backend learns which fields exist and their code seeds. In a per-language pass
 * `language` is the active language and only its seeds are included (mirroring
 * how cue translations carry a single language). Returns `null` when the spec
 * declares no `text`.
 */
export function buildTextDeclaration(
  localize: NormalizedLocalize | undefined,
  language: string | undefined,
  studioText: readonly string[] = []
): TextDeclaration | null {
  const text = localize?.text
  const seededFields = text?.fieldNames ?? []
  const fields = [...seededFields, ...studioText]
  if (fields.length === 0) return null

  const declaration: TextDeclaration = {
    fields,
    studioFields: [...studioText],
  }

  if (language !== undefined && text) {
    const langSeed = (
      text.seedByLang as Record<string, Record<string, string>>
    )[language]
    if (langSeed !== undefined && Object.keys(langSeed).length > 0) {
      declaration.seed = { [language]: langSeed }
    }
  }

  return declaration
}
