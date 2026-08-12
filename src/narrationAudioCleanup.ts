/**
 * Audio cleanup options for self-recorded narration (media-file cues).
 *
 * Cleanup applies only to narration audio the user recorded themselves. It
 * never touches generated narration, background audio tracks, or captured
 * screen audio. Off by default: the feature activates only when the user opts
 * in via `renderOptions: { narration: { audio: ... } }`.
 */

export const DEFAULT_DENOISE_STRENGTH = 0.85
export const DEFAULT_NORMALIZE_LEVEL = -16

export const MIN_NORMALIZE_LEVEL = -30
export const MAX_NORMALIZE_LEVEL = -8

/**
 * User-facing option: `true` enables the full cleanup chain (denoise and
 * loudness normalization) with defaults, `false`/`undefined` disables it, and
 * the object form enables only the listed sub-features with optional tuning.
 */
export type NarrationAudioCleanupOption =
  | boolean
  | {
      /** Background noise reduction. `strength` is the 0-1 mix, default 0.85. */
      denoise?: boolean | { strength?: number }
      /** Loudness normalization. `level` is the LUFS target, default -16. */
      normalize?: boolean | { level?: number }
    }

/**
 * Fully resolved cleanup settings, as written to `data.json` and consumed by
 * the renderer. A sub-feature is either `false` (disabled) or an object with
 * every tuning value present and clamped.
 */
export type ResolvedNarrationAudioCleanup = {
  denoise: { strength: number } | false
  normalize: { level: number } | false
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function resolveDenoise(
  input: boolean | { strength?: number } | undefined,
  enabledByDefault: boolean
): { strength: number } | false {
  if (input === undefined) {
    return enabledByDefault ? { strength: DEFAULT_DENOISE_STRENGTH } : false
  }
  if (typeof input === 'boolean') {
    return input ? { strength: DEFAULT_DENOISE_STRENGTH } : false
  }
  const strength = clamp(input.strength ?? DEFAULT_DENOISE_STRENGTH, 0, 1)
  if (
    input.strength !== undefined &&
    (strength !== input.strength || !Number.isFinite(input.strength))
  ) {
    console.warn(
      `narration.audio.denoise.strength ${input.strength} is out of range, ` +
        `clamped to ${strength} (valid range 0 to 1)`
    )
  }
  return { strength }
}

function resolveNormalize(
  input: boolean | { level?: number } | undefined,
  enabledByDefault: boolean
): { level: number } | false {
  if (input === undefined) {
    return enabledByDefault ? { level: DEFAULT_NORMALIZE_LEVEL } : false
  }
  if (typeof input === 'boolean') {
    return input ? { level: DEFAULT_NORMALIZE_LEVEL } : false
  }
  const level = clamp(
    input.level ?? DEFAULT_NORMALIZE_LEVEL,
    MIN_NORMALIZE_LEVEL,
    MAX_NORMALIZE_LEVEL
  )
  if (
    input.level !== undefined &&
    (level !== input.level || !Number.isFinite(input.level))
  ) {
    console.warn(
      `narration.audio.normalize.level ${input.level} is out of range, ` +
        `clamped to ${level} (valid range ${MIN_NORMALIZE_LEVEL} to ${MAX_NORMALIZE_LEVEL} LUFS)`
    )
  }
  return { level }
}

/**
 * Convert the user-facing boolean-or-object option into the resolved form.
 * Returns `undefined` when cleanup is fully disabled so callers can omit the
 * field entirely (the feature is off by default).
 */
export function resolveNarrationAudioCleanup(
  input: NarrationAudioCleanupOption | undefined
): ResolvedNarrationAudioCleanup | undefined {
  if (input === undefined || input === false) return undefined
  if (input === true) {
    return {
      denoise: { strength: DEFAULT_DENOISE_STRENGTH },
      normalize: { level: DEFAULT_NORMALIZE_LEVEL },
    }
  }
  const denoise = resolveDenoise(input.denoise, false)
  const normalize = resolveNormalize(input.normalize, false)
  if (denoise === false && normalize === false) return undefined
  return { denoise, normalize }
}
