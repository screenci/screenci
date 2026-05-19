import { isCustomVoiceRef } from './voices.js'
import { isInsideHide } from './hide.js'
import { access, readFile } from 'fs/promises'
import { createHash } from 'crypto'
import { dirname, resolve } from 'path'
// One frame at 24fps — ensures at least one rendered frame captures each cue state.
export const ONE_FRAME_MS = 1000 / 24
// Blocking sleep — spin until the elapsed time has passed
let sleepFn = (ms) => {
  const end = performance.now() + ms
  while (performance.now() < end) {
    /* spin */
  }
}
export function setSleepFn(fn) {
  sleepFn = fn
}
let activeRecorder = null
let cueStarted = false
const usedCueNames = new Set()
const registeredCustomVoiceRefs = new Set()
/** Maps local asset path → SHA-256 hash, populated during validateCustomVoiceRefs. */
const videoCueFileHashes = new Map()
export function setActiveCueRecorder(recorder) {
  activeRecorder = recorder
  usedCueNames.clear()
}
export function resetCueChain() {
  cueStarted = false
  usedCueNames.clear()
}
export function resetRegisteredCustomVoiceRefs() {
  registeredCustomVoiceRefs.clear()
  videoCueFileHashes.clear()
}
export async function validateCustomVoiceRefs(testFilePath) {
  const testDir = dirname(testFilePath)
  for (const ref of registeredCustomVoiceRefs) {
    const candidates = [ref.path, resolve(testDir, ref.path)]
    let fileBuffer = null
    for (const candidate of candidates) {
      try {
        await access(candidate)
        fileBuffer = await readFile(candidate)
        break
      } catch {
        // try next candidate
      }
    }
    if (fileBuffer === null) {
      throw new Error(`Custom voice file not found: ${ref.path}`)
    }
    ref.assetHash = createHash('sha256').update(fileBuffer).digest('hex')
  }
  for (const assetPath of videoCueFileHashes.keys()) {
    const candidates = [assetPath, resolve(testDir, assetPath)]
    let fileBuffer = null
    for (const candidate of candidates) {
      try {
        fileBuffer = await readFile(candidate)
        break
      } catch {
        // try next candidate
      }
    }
    if (fileBuffer === null) {
      throw new Error(`Video cue asset file not found: ${assetPath}`)
    }
    videoCueFileHashes.set(
      assetPath,
      createHash('sha256').update(fileBuffer).digest('hex')
    )
  }
}
function toRecordedVoice(voice) {
  if (!isCustomVoiceRef(voice)) return voice
  if (!('assetHash' in voice) || typeof voice.assetHash !== 'string') {
    throw new Error(`Custom voice assetHash missing for path: ${voice.path}`)
  }
  return {
    assetHash: voice.assetHash,
    assetPath: voice.path,
  }
}
/**
 * Auto-ends any currently active cue before starting a new one.
 * Called internally at the start of every narration controller.
 */
function cueAutoEnd() {
  if (!cueStarted || activeRecorder === null) return
  activeRecorder.addCueEnd('auto')
  sleepFn(2 * ONE_FRAME_MS)
  cueStarted = false
}
function assertUniqueCueName(name) {
  if (usedCueNames.has(name)) {
    throw new Error(
      `Duplicate cue name "${name}" in one video recording. Cue names must be unique.`
    )
  }
  usedCueNames.add(name)
}
async function doWait() {
  if (activeRecorder === null || !cueStarted) return
  if (isInsideHide()) throw new Error('Cannot call wait() inside hide()')
  activeRecorder.addCueEnd('wait')
  sleepFn(2 * ONE_FRAME_MS)
  cueStarted = false
}
/**
 * Creates a set of typed narration controllers, one per key in the map.
 *
 * Each controller has `start()` and `end()`.
 * At render time screenci generates narration, and syncs the audio to the
 * recording. You write text; the voice is handled for you.
 *
 * The top-level `voice` applies to all languages. Override it per-language via
 * the `voice` field inside each language entry. Only language-level overrides
 * may set `seed`.
 *
 * TypeScript enforces that every language has the same cue keys.
 * Forget a translation key → compile error.
 *
 * @example
 * ```ts
 * const narration = createNarration({
 *   voice: { name: voices.Ava, style: 'Clear and friendly' },
 *   languages: {
 *     en: { cues: { intro: 'Welcome.', next: 'Click here.' } },
 *     fi: {
 *       voice: { name: voices.Nora, style: 'Selkeä opastus', seed: 42 },
 *       cues: { intro: 'Tervetuloa.', next: 'Napsauta tästä.' },
 *     },
 *   },
 * })
 *
 * // Await a narration segment directly to start it:
 * await narration.intro
 * await page.goto('/dashboard')
 *
 * // Consecutive narration segments sequence automatically:
 * await narration.intro
 * await narration.next  // ends intro, then starts next
 *
 * // Wait for audio to finish before an action:
 * await narration.intro
 * await narration.wait()
 * await page.click('#start')
 * ```
 */
export function createNarration(input) {
  return buildCuesFromInput(input.voice, input.languages)
}
function normalizeCueMapValue(value) {
  if (typeof value === 'string') {
    return { type: 'text', text: value }
  }
  if ('text' in value) {
    return { type: 'text', text: value.text }
  }
  const mediaPath = 'media' in value ? value.media : value.path
  return {
    type: 'file',
    path: mediaPath,
    ...(value.subtitle !== undefined && { subtitle: value.subtitle }),
  }
}
function getLanguageCues(entry) {
  if (entry === undefined) return undefined
  return entry.cues
}
function voiceToKeyString(voice) {
  if (isCustomVoiceRef(voice)) return `custom:${voice.path}`
  return voice
}
function buildCuesFromInput(topVoice, languages) {
  const langs = Object.keys(languages)
  const firstLang = langs[0]
  if (firstLang === undefined) {
    throw new Error(
      'createNarration requires at least one language in "languages"'
    )
  }
  // Resolve effective voice and metadata per language
  const resolvedVoices = new Map()
  const resolvedVoiceMeta = new Map()
  for (const lang of langs) {
    const entry = languages[lang]
    const langOverride = entry?.voice
    const effectiveVoiceName = langOverride?.name ?? topVoice.name
    const effectiveSeed = langOverride?.seed
    const effectiveRegion = entry?.region
    // If a lang override exists it owns style/accent/pacing entirely — no inheritance from the
    // top-level voice. This prevents a top-level `style` from forcing `expressive` on a lang
    // that explicitly sets `modelType: 'consistent'`.
    const effectiveStyle =
      langOverride !== undefined
        ? langOverride?.style
        : 'style' in topVoice
          ? topVoice.style
          : undefined
    const effectiveAccent =
      langOverride !== undefined
        ? langOverride?.accent
        : 'accent' in topVoice
          ? topVoice.accent
          : undefined
    const effectivePacing =
      langOverride !== undefined
        ? langOverride?.pacing
        : 'pacing' in topVoice
          ? topVoice.pacing
          : undefined
    const effectiveModelType = effectiveStyle
      ? 'expressive'
      : (langOverride?.modelType ?? topVoice.modelType)
    if (isCustomVoiceRef(effectiveVoiceName)) {
      registeredCustomVoiceRefs.add(effectiveVoiceName)
    }
    resolvedVoices.set(lang, effectiveVoiceName)
    resolvedVoiceMeta.set(lang, {
      name: voiceToKeyString(effectiveVoiceName),
      ...(effectiveSeed !== undefined && { seed: effectiveSeed }),
      ...(effectiveRegion !== undefined && { region: effectiveRegion }),
      ...(effectiveModelType !== undefined && {
        modelType: effectiveModelType,
      }),
      ...(effectiveStyle !== undefined && { style: effectiveStyle }),
      ...(effectiveAccent !== undefined && { accent: effectiveAccent }),
      ...(effectivePacing !== undefined && { pacing: effectivePacing }),
    })
  }
  const firstEntry = languages[firstLang]
  if (!firstEntry) return {}
  const result = {}
  const firstCues = getLanguageCues(firstEntry)
  if (firstCues === undefined) return {}
  for (const key in firstCues) {
    const keyStr = key
    const normalizedByLang = new Map()
    // Normalize shorthand values and determine if any language uses a file entry for this key.
    let hasFileEntry = false
    for (const lang of langs) {
      const val = getLanguageCues(languages[lang])?.[keyStr]
      if (val !== undefined) {
        const normalized = normalizeCueMapValue(val)
        normalizedByLang.set(lang, normalized)
        if (normalized.type === 'file') {
          hasFileEntry = true
          videoCueFileHashes.set(normalized.path, '')
        }
      }
    }
    if (hasFileEntry) {
      const fileStartFn = async () => {
        if (isInsideHide())
          throw new Error('Cannot start narration inside hide()')
        if (activeRecorder === null) return
        assertUniqueCueName(keyStr)
        cueAutoEnd()
        for (const lang of langs) {
          activeRecorder.registerVoiceForLang(lang, resolvedVoiceMeta.get(lang))
        }
        const videoTranslations = {}
        for (const lang of langs) {
          const val = normalizedByLang.get(lang)
          if (val === undefined) continue
          const voice = resolvedVoices.get(lang)
          const region = languages[lang]?.region
          const meta = resolvedVoiceMeta.get(lang)
          const modelType = meta?.modelType
          const style = meta?.style
          const accent = meta?.accent
          const pacing = meta?.pacing
          if (val.type === 'text') {
            videoTranslations[lang] = {
              text: val.text,
              voice: toRecordedVoice(voice),
              ...(region !== undefined && { region }),
              ...(modelType !== undefined && { modelType }),
              ...(style !== undefined && { style }),
              ...(accent !== undefined && { accent }),
              ...(pacing !== undefined && { pacing }),
            }
          } else {
            videoTranslations[lang] = entryToVideoTranslation({
              path: val.path,
              ...(val.subtitle !== undefined && { subtitle: val.subtitle }),
            })
          }
        }
        cueStarted = true
        sleepFn(2 * ONE_FRAME_MS)
        activeRecorder.addVideoCueStart(
          keyStr,
          undefined,
          undefined,
          undefined,
          videoTranslations
        )
      }
      result[keyStr] = {
        then(resolve, reject) {
          return fileStartFn().then(resolve, reject)
        },
      }
    } else {
      const textStartFn = async () => {
        if (isInsideHide())
          throw new Error('Cannot start narration inside hide()')
        if (activeRecorder === null) return
        assertUniqueCueName(keyStr)
        cueAutoEnd()
        for (const lang of langs) {
          activeRecorder.registerVoiceForLang(lang, resolvedVoiceMeta.get(lang))
        }
        const textTranslations = {}
        for (const lang of langs) {
          const val = normalizedByLang.get(lang)
          if (val !== undefined && val.type === 'text') {
            const voice = resolvedVoices.get(lang)
            const region = languages[lang]?.region
            const meta = resolvedVoiceMeta.get(lang)
            const modelType = meta?.modelType
            const style = meta?.style
            const accent = meta?.accent
            const pacing = meta?.pacing
            textTranslations[lang] = {
              text: val.text,
              voice: toRecordedVoice(voice),
              ...(region !== undefined && { region }),
              ...(modelType !== undefined && { modelType }),
              ...(style !== undefined && { style }),
              ...(accent !== undefined && { accent }),
              ...(pacing !== undefined && { pacing }),
            }
          }
        }
        cueStarted = true
        sleepFn(2 * ONE_FRAME_MS)
        activeRecorder.addCueStart('', keyStr, undefined, textTranslations)
      }
      result[keyStr] = {
        then(resolve, reject) {
          return textStartFn().then(resolve, reject)
        },
      }
    }
  }
  result.wait = doWait
  return result
}
function entryToVideoTranslation(entry) {
  const path = typeof entry === 'string' ? entry : entry.path
  const subtitle = typeof entry === 'string' ? undefined : entry.subtitle
  const assetHash = videoCueFileHashes.get(path)
  if (!assetHash)
    throw new Error(`Video cue asset hash missing for path: ${path}`)
  return {
    assetHash,
    assetPath: path,
    ...(subtitle !== undefined && { subtitle }),
  }
}
