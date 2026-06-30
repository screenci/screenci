import { buildLocalizedNarrationCues, type NarrationCue } from './cue.js'
import {
  normalizeCueValue,
  type LocalizeNarrationValue,
  type NormalizedCueValue,
  type NormalizedNarration,
  type VoiceConfig,
} from './localize.js'
import type { NormalizedFeature } from './declare.js'
import type { Lang } from './voices.js'
import type { ValuesOverrides } from './runtimeMode.js'
import type { TopLevelVoiceConfig } from './voiceConfig.js'
import type { RenderOptions } from './types.js'

/**
 * The config/global default narration voice from a recording's render options.
 * Lowest-priority entry in the voice cascade: the per-cue `voice` overrides it.
 * When render options are deferred to Studio there is no code voice here.
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

/** Per-language values fields, keyed by field name. */
export type Values = Record<string, string>

/**
 * Convert a per-feature narration declaration into the normalized shape the voice
 * / translation pipeline consumes. Each language resolves `byLang[lang] ?? shared`
 * (the fallback-to-shared rule); a studio (array) declaration carries names only.
 */
function featureToNormalizedNarration(
  feature: NormalizedFeature<LocalizeNarrationValue> | null,
  languages: string[]
): NormalizedNarration {
  if (feature === null) return null
  const seedByLang: Partial<Record<Lang, Record<string, NormalizedCueValue>>> =
    {}
  for (const lang of languages) {
    const cues: Record<string, NormalizedCueValue> = {}
    for (const name of feature.codeNames) {
      const value = feature.byLang[lang]?.[name] ?? feature.shared[name]
      if (value !== undefined) cues[name] = normalizeCueValue(name, value)
    }
    if (Object.keys(cues).length > 0) seedByLang[lang as Lang] = cues
  }
  return {
    cueNames: feature.names,
    studioNames: feature.studioNames,
    seededNames: feature.codeNames,
    seedByLang,
  }
}

/**
 * Build the `narration` marker object. Code cues emit translations (resolved per
 * `(cue, language)`, filtered to the active language by the recorder); studio
 * (array) cues emit studio cue starts whose text is owned by the web app.
 */
export function buildNarrationMarkers(
  narration: NormalizedFeature<LocalizeNarrationValue> | null | undefined,
  languages: string[],
  defaultVoice?: TopLevelVoiceConfig,
  voiceByLang: Partial<Record<string, VoiceConfig>> = {},
  // The `.screenci` script that media paths resolve against. When provided, the
  // file-backed cues' media is pre-warmed (hashed) up front so their start()
  // does not pay the read on the recording timeline. Omitted outside recording.
  anchorFile?: string
): NarrationMarkers {
  const normalized = featureToNormalizedNarration(narration ?? null, languages)
  return buildLocalizedNarrationCues(
    normalized,
    voiceByLang,
    defaultVoice,
    anchorFile
  )
}

/**
 * Resolve the `values` fields for the active language: a Studio override wins
 * over the per-language seed, which wins over the shared value, then the empty
 * string (Studio-owned fields stay empty until set in the web app).
 */
export function buildValues(
  feature: NormalizedFeature<string> | null | undefined,
  language: string | undefined,
  overrides?: ValuesOverrides | null
): Values {
  if (!feature || feature.names.length === 0) return {}
  const override = language !== undefined ? overrides?.[language] : undefined
  const langSeed = language !== undefined ? feature.byLang[language] : undefined
  const values: Values = {}
  for (const field of feature.names) {
    values[field] =
      override?.[field] ?? langSeed?.[field] ?? feature.shared[field] ?? ''
  }
  return values
}

/** A localized values declaration emitted to the backend at recording start. */
export type ValuesDeclaration = {
  /** Every field name (code then Studio-managed), in declared order. */
  fields: string[]
  /** Studio-managed field names (array form, no code seed). */
  studioFields: string[]
  /** Code seeds keyed `{ [language]: { [field]: value } }`. Omitted when empty. */
  seed?: Record<string, Record<string, string>>
}

/**
 * Build the declaration of `values` fields to emit at recording start so the
 * backend learns which fields exist (and their code seeds) and can present the
 * Studio-managed ones for the user to fill. Returns `null` when none declared.
 */
export function buildValuesDeclaration(
  feature: NormalizedFeature<string> | null | undefined,
  language: string | undefined
): ValuesDeclaration | null {
  if (!feature || feature.names.length === 0) return null

  const declaration: ValuesDeclaration = {
    fields: feature.names,
    studioFields: feature.studioNames,
  }

  if (language !== undefined) {
    const merged: Record<string, string> = {
      ...feature.shared,
      ...(feature.byLang[language] ?? {}),
    }
    const codeSeed: Record<string, string> = {}
    for (const field of feature.codeNames) {
      if (merged[field] !== undefined) codeSeed[field] = merged[field]!
    }
    if (Object.keys(codeSeed).length > 0) {
      declaration.seed = { [language]: codeSeed }
    }
  }

  return declaration
}
