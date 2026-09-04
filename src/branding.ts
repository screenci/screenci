import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { SECRET_HEADER } from './anonSession.js'
import type { AspectRatio, Quality } from './types.js'
import { voices } from './voices.js'

/**
 * The organisation's branding as the service resolves it for a project: the
 * background, output size, cursor style and default narration voice every new
 * video should start from. Fetched by `screenci start` (in the setup-code
 * exchange) and `screenci context` (`GET /cli/dev/branding`), and printed for
 * the coding agent, which writes the values into the video code. Nothing is
 * applied at record time: code is the source of truth and may deviate.
 *
 * A cloned voice references a sample stored by the service; `start` and
 * `context` download it into the workspace (`branding/<file>`) so the script
 * can point `voices.elevenlabs({ path })` at it.
 *
 * Shared ASSETS are the exception to "nothing is applied at render time": the
 * values above are copied into the code, but `{ branding: '<name>' }` stays a
 * live reference that the export resolves to whatever file the Branding page
 * holds then. Replacing a logo therefore updates every video on its next
 * export, and the service marks the earlier exports outdated.
 */

export type BrandingSource = 'project' | 'org' | 'none'

export type CliBrandingVoice =
  | { kind: 'builtIn'; name: string }
  | { kind: 'elevenlabs'; voiceId: string; name: string | null }
  | { kind: 'sample'; fileHash: string; fileName: string }

export const BRANDING_FIELDS = [
  'backgroundCss',
  'aspectRatio',
  'quality',
  'cursorStyle',
  'voice',
] as const

export type BrandingField = (typeof BRANDING_FIELDS)[number]

/** A shared image or video asset the video code references by name. */
export type CliBrandingAsset = {
  name: string
  kind: 'image' | 'video'
  /** Free-text instructions from the Branding page, for the coding agent. */
  guide: string
  fileName: string
  fileHash: string
  size: number
  source: Exclude<BrandingSource, 'none'>
}

export type CliBranding = {
  backgroundCss: string | null
  aspectRatio: AspectRatio | null
  quality: Quality | null
  cursorStyle: 'white' | 'black' | null
  voice: CliBrandingVoice | null
  /** Problems the service found (plan, missing API key), printed verbatim. */
  warnings: string[]
  sources: Record<BrandingField, BrandingSource>
  /** Shared assets, referenced from code by name and resolved at export. */
  assets: CliBrandingAsset[]
}

export const EMPTY_BRANDING: CliBranding = {
  backgroundCss: null,
  aspectRatio: null,
  quality: null,
  cursorStyle: null,
  voice: null,
  warnings: [],
  sources: {
    backgroundCss: 'none',
    aspectRatio: 'none',
    quality: 'none',
    cursorStyle: 'none',
    voice: 'none',
  },
  assets: [],
}

// Exhaustive over the public unions: adding a ratio or quality to types.ts
// without listing it here is a type error.
const ASPECT_RATIO_SET: Record<AspectRatio, true> = {
  '16:9': true,
  '9:16': true,
  '1:1': true,
  '4:3': true,
  '3:4': true,
  '5:4': true,
  '4:5': true,
}
const QUALITY_SET: Record<Quality, true> = {
  '720p': true,
  '1080p': true,
  '1440p': true,
  '2160p': true,
}

function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === 'string' && value in ASPECT_RATIO_SET
}

function isQuality(value: unknown): value is Quality {
  return typeof value === 'string' && value in QUALITY_SET
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function source(value: unknown): BrandingSource {
  return value === 'project' || value === 'org' ? value : 'none'
}

const SHA256_HEX = /^[a-f0-9]{64}$/

function parseVoice(value: unknown): CliBrandingVoice | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  switch (v.kind) {
    case 'builtIn': {
      const name = optionalString(v.name)
      return name !== null &&
        name !== 'elevenlabs' &&
        Object.prototype.hasOwnProperty.call(voices, name)
        ? { kind: 'builtIn', name }
        : null
    }
    case 'elevenlabs': {
      const voiceId = optionalString(v.voiceId)
      return voiceId !== null
        ? { kind: 'elevenlabs', voiceId, name: optionalString(v.name) }
        : null
    }
    case 'sample': {
      const fileHash = optionalString(v.fileHash)
      const fileName = optionalString(v.fileName)
      return fileHash !== null && SHA256_HEX.test(fileHash) && fileName !== null
        ? { kind: 'sample', fileHash, fileName }
        : null
    }
    default:
      return null
  }
}

/** Tolerant parse of the asset list: an entry the CLI cannot use is dropped. */
function parseAssets(value: unknown): CliBrandingAsset[] {
  if (!Array.isArray(value)) return []
  const byName = new Map<string, CliBrandingAsset>()
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const a = entry as Record<string, unknown>
    const name = optionalString(a.name)
    const fileName = optionalString(a.fileName)
    const fileHash = optionalString(a.fileHash)
    if (
      name === null ||
      fileName === null ||
      fileHash === null ||
      !SHA256_HEX.test(fileHash) ||
      (a.kind !== 'image' && a.kind !== 'video') ||
      typeof a.size !== 'number' ||
      !Number.isFinite(a.size)
    ) {
      continue
    }
    if (byName.has(name)) continue
    byName.set(name, {
      name,
      kind: a.kind,
      guide: optionalString(a.guide) ?? '',
      fileName,
      fileHash,
      size: a.size,
      source: a.source === 'project' ? 'project' : 'org',
    })
  }
  return [...byName.values()]
}

/** Tolerant parse: an older server (no branding at all) yields the empty one. */
export function parseBranding(value: unknown): CliBranding {
  if (typeof value !== 'object' || value === null) return EMPTY_BRANDING
  const v = value as Record<string, unknown>
  const sources = (
    typeof v.sources === 'object' && v.sources !== null ? v.sources : {}
  ) as Record<string, unknown>
  const voice = parseVoice(v.voice)
  const cursorStyle =
    v.cursorStyle === 'white' || v.cursorStyle === 'black'
      ? v.cursorStyle
      : null
  const aspectRatio = isAspectRatio(v.aspectRatio) ? v.aspectRatio : null
  const quality = isQuality(v.quality) ? v.quality : null
  const backgroundCss = optionalString(v.backgroundCss)
  const warnings = Array.isArray(v.warnings)
    ? v.warnings.filter((w): w is string => typeof w === 'string')
    : []
  // A value the CLI cannot use (unknown voice, bad ratio) reads as unset.
  const pick = (key: BrandingField, present: boolean): BrandingSource =>
    present ? source(sources[key]) : 'none'
  return {
    backgroundCss,
    aspectRatio,
    quality,
    cursorStyle,
    voice,
    warnings,
    sources: {
      backgroundCss: pick('backgroundCss', backgroundCss !== null),
      aspectRatio: pick('aspectRatio', aspectRatio !== null),
      quality: pick('quality', quality !== null),
      cursorStyle: pick('cursorStyle', cursorStyle !== null),
      voice: pick('voice', voice !== null),
    },
    assets: parseAssets(v.assets),
  }
}

export function isEmptyBranding(branding: CliBranding): boolean {
  return (
    BRANDING_FIELDS.every((field) => branding[field] === null) &&
    branding.assets.length === 0
  )
}

export type FetchBrandingResult =
  | {
      ok: true
      branding: CliBranding
      projectName: string | null
      /**
       * False when the service has no branding route at all (an older
       * deployment). The branding is then the empty one, which is NOT the same
       * as "the organisation defined no shared assets": callers that check
       * `{ branding: '<name>' }` references must skip the check rather than
       * report every name as missing.
       */
      supported: boolean
    }
  | { ok: false; message: string }

/** `GET /cli/dev/branding` for `screenci context`. */
export async function fetchBranding(
  params: { apiUrl: string; secret: string; projectName?: string | undefined },
  fetchFn: typeof fetch
): Promise<FetchBrandingResult> {
  const url = new URL(`${params.apiUrl}/cli/dev/branding`)
  if (params.projectName !== undefined) {
    url.searchParams.set('projectName', params.projectName)
  }
  let response: Response
  try {
    response = await fetchFn(url.toString(), {
      headers: { [SECRET_HEADER]: params.secret },
    })
  } catch (err) {
    return {
      ok: false,
      message: `Could not reach ScreenCI: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  // An older server has no branding route at all: that is the empty
  // branding, the same shape `screenci start` uses for an exchange without it.
  if (response.status === 404) {
    await response.body?.cancel()
    return {
      ok: true,
      branding: EMPTY_BRANDING,
      projectName: null,
      supported: false,
    }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return {
      ok: false,
      message: `Fetching the branding failed with status ${response.status}${text ? `: ${text}` : ''}`,
    }
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, message: 'The branding response is not JSON' }
  }
  const b = (body ?? {}) as Record<string, unknown>
  return {
    ok: true,
    branding: parseBranding(body),
    projectName: optionalString(b.projectName),
    supported: true,
  }
}

/** Folder inside the workspace that holds the downloaded voice sample. */
export const BRANDING_SAMPLE_DIR = 'branding'

/**
 * A safe file name for the sample: the base name with unsafe characters
 * replaced, keeping the extension (which the clone pipeline needs).
 */
export function safeSampleFileName(fileName: string): string {
  const base = fileName.split(/[\/]/).pop() ?? fileName
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot).replace(/[^A-Za-z0-9.]+/g, '') : ''
  const cleaned = stem
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
  return `${cleaned === '' ? 'voice-sample' : cleaned}${ext}`
}

export type DownloadBrandingSampleResult =
  | { status: 'written' | 'kept'; relativePath: string; fileName: string }
  | { status: 'none' }
  | { status: 'error'; message: string }

export type DownloadSampleDeps = {
  fetchFn: typeof fetch
  /** The file's bytes, or null when it does not exist. */
  readFile: (path: string) => Promise<Uint8Array | null>
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>
  mkdir: (dir: string) => Promise<unknown>
  sha256: (bytes: Uint8Array) => string
}

export const defaultDownloadSampleDeps: Omit<DownloadSampleDeps, 'fetchFn'> = {
  readFile: async (path) => {
    try {
      const { readFile } = await import('node:fs/promises')
      return new Uint8Array(await readFile(path))
    } catch {
      return null
    }
  },
  writeFile: async (path, bytes) => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, bytes)
  },
  mkdir: async (dir) => {
    const { mkdir } = await import('node:fs/promises')
    return mkdir(dir, { recursive: true })
  },
  sha256: (bytes) => createHash('sha256').update(bytes).digest('hex'),
}

/**
 * Saves one branding file (the voice sample, or a shared asset) as
 * `<islandDir>/branding/<file>`. An identical local file is kept as is; 404
 * means the service has nothing to serve for this request.
 */
export async function downloadBrandingFile(
  params: {
    apiUrl: string
    secret: string
    islandDir: string
    projectName?: string | undefined
    /** Path under `/cli/branding`, e.g. `voice-sample` or `asset/logo`. */
    route: string
    /** File name to fall back on when the response carries none. */
    fallbackName: string
    /** Base name to save under, keeping the served extension. */
    saveAs?: string
  },
  deps: DownloadSampleDeps
): Promise<DownloadBrandingSampleResult> {
  const url = new URL(`${params.apiUrl}/cli/branding/${params.route}`)
  if (params.projectName !== undefined) {
    url.searchParams.set('projectName', params.projectName)
  }
  let response: Response
  try {
    response = await deps.fetchFn(url.toString(), {
      headers: { [SECRET_HEADER]: params.secret },
    })
  } catch (err) {
    return {
      status: 'error',
      message: `Could not reach ScreenCI: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (response.status === 404) {
    await response.body?.cancel()
    return { status: 'none' }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return {
      status: 'error',
      message: `Downloading the voice sample failed with status ${response.status}${text ? `: ${text}` : ''}`,
    }
  }
  const rawName = response.headers.get('X-ScreenCI-File-Name')
  // A malformed percent escape in the header would otherwise throw straight
  // out of a best-effort download and abort `screenci start` after it already
  // wrote the secret, leaving the agent with no brief.
  const servedName =
    rawName !== null ? decodeName(rawName) : params.fallbackName
  const fileName = safeSampleFileName(
    params.saveAs !== undefined
      ? `${params.saveAs}${extensionOf(servedName)}`
      : servedName
  )
  const expectedHash = response.headers.get('X-ScreenCI-File-Hash')
  const bytes = new Uint8Array(await response.arrayBuffer())
  const hash = deps.sha256(bytes)
  if (expectedHash !== null && expectedHash !== hash) {
    return {
      status: 'error',
      message: 'The downloaded voice sample did not match its hash',
    }
  }
  const relativePath = `${BRANDING_SAMPLE_DIR}/${fileName}`
  const absolutePath = join(params.islandDir, BRANDING_SAMPLE_DIR, fileName)
  // Disk failures are reported, never thrown: every caller treats this as
  // best-effort and continues without the file (see `formatBrandingSection`,
  // which tells the agent how to retry).
  try {
    const existing = await deps.readFile(absolutePath)
    if (existing !== null && deps.sha256(existing) === hash) {
      return { status: 'kept', relativePath, fileName }
    }
    await deps.mkdir(join(params.islandDir, BRANDING_SAMPLE_DIR))
    await deps.writeFile(absolutePath, bytes)
  } catch (err) {
    return {
      status: 'error',
      message: `Could not save ${relativePath}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  return { status: 'written', relativePath, fileName }
}

/** Tolerates a header that is not valid percent-encoding. */
function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** The extension of a served file name, including the dot ('' when none). */
function extensionOf(fileName: string): string {
  const base = fileName.split(/[\/]/).pop() ?? fileName
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot) : ''
}

/**
 * `GET /cli/branding/voice-sample`: saves the sample behind the branding voice.
 * 404 means the effective voice is not a cloned sample.
 */
export async function downloadBrandingVoiceSample(
  params: {
    apiUrl: string
    secret: string
    islandDir: string
    projectName?: string | undefined
  },
  deps: DownloadSampleDeps
): Promise<DownloadBrandingSampleResult> {
  return await downloadBrandingFile(
    { ...params, route: 'voice-sample', fallbackName: 'voice-sample' },
    deps
  )
}

/**
 * Saves every shared branding asset as `branding/<name><ext>` so the agent can
 * inspect it and local previews can show it. The upload still sends only the
 * name: the export resolves it against the Branding page.
 */
export async function downloadBrandingAssets(
  params: {
    apiUrl: string
    secret: string
    islandDir: string
    projectName?: string | undefined
  },
  assets: readonly CliBrandingAsset[],
  deps: DownloadSampleDeps
): Promise<Record<string, DownloadBrandingSampleResult>> {
  const results: Record<string, DownloadBrandingSampleResult> = {}
  for (const asset of assets) {
    results[asset.name] = await downloadBrandingFile(
      {
        ...params,
        route: `asset/${encodeURIComponent(asset.name)}`,
        fallbackName: asset.fileName,
        saveAs: asset.name,
      },
      deps
    )
  }
  return results
}

/** The workspace-relative paths of the assets that were saved locally. */
export function brandingAssetPaths(
  results: Record<string, DownloadBrandingSampleResult>
): Record<string, string> {
  const paths: Record<string, string> = {}
  for (const [name, result] of Object.entries(results)) {
    if (result.status === 'written' || result.status === 'kept') {
      paths[name] = result.relativePath
    }
  }
  return paths
}

function voiceExpression(
  voice: CliBrandingVoice,
  samplePath: string | null
): string | null {
  switch (voice.kind) {
    case 'builtIn':
      return `{ name: ${JSON.stringify(voice.name)} }`
    case 'elevenlabs':
      return `{ name: voices.elevenlabs({ voiceId: ${JSON.stringify(voice.voiceId)} }) }`
    case 'sample':
      return samplePath !== null
        ? `{ name: voices.elevenlabs({ path: ${JSON.stringify(`./${samplePath}`)} }) }`
        : null
    default: {
      const exhaustive: never = voice
      throw new Error(`Unhandled voice: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * The code an agent should put on a new video so it follows the branding.
 * Null when nothing is set. `samplePath` is the workspace-relative path of the
 * downloaded voice sample (null when it is not available locally).
 */
export function brandingRenderOptionsSnippet(
  branding: CliBranding,
  samplePath: string | null
): string | null {
  if (isEmptyBranding(branding)) return null
  const output: string[] = []
  if (branding.backgroundCss !== null) {
    output.push(
      `      background: { backgroundCss: ${JSON.stringify(branding.backgroundCss)} },`
    )
  }
  if (branding.aspectRatio !== null) {
    output.push(`      aspectRatio: ${JSON.stringify(branding.aspectRatio)},`)
  }
  if (branding.quality !== null) {
    output.push(`      quality: ${JSON.stringify(branding.quality)},`)
  }
  const render: string[] = []
  if (output.length > 0) render.push('    output: {', ...output, '    },')
  if (branding.cursorStyle !== null) {
    render.push(
      `    mouse: { style: ${JSON.stringify(branding.cursorStyle)} },`
    )
  }
  const voice =
    branding.voice !== null ? voiceExpression(branding.voice, samplePath) : null
  if (voice !== null) render.push(`    narration: { voice: ${voice} },`)
  const record: string[] = []
  if (branding.aspectRatio !== null) {
    record.push(`aspectRatio: ${JSON.stringify(branding.aspectRatio)}`)
  }
  if (branding.quality !== null) {
    record.push(`quality: ${JSON.stringify(branding.quality)}`)
  }
  const lines: string[] = []
  if (branding.voice !== null && branding.voice.kind !== 'builtIn') {
    lines.push("import { video, voices } from 'screenci'", '')
  }
  lines.push('video')
  if (record.length > 0) {
    lines.push(`  .recordOptions({ ${record.join(', ')} })`)
  }
  if (render.length > 0) {
    lines.push('  .renderOptions({', ...render, '  })')
  }
  lines.push("('<video title>', async ({ page }) => {", '  // ...', '})')
  return lines.join('\n')
}

export function describeBrandingVoice(
  voice: CliBrandingVoice,
  samplePath: string | null
): string {
  switch (voice.kind) {
    case 'builtIn':
      return `${voice.name} (built-in)`
    case 'elevenlabs':
      return `ElevenLabs voice ${voice.name ?? voice.voiceId} (id ${voice.voiceId})`
    case 'sample':
      return samplePath !== null
        ? `cloned from the organisation's sample, saved as ${samplePath}`
        : `cloned from the organisation's sample "${voice.fileName}" (not downloaded; run \`npx screenci context\` to fetch it)`
    default: {
      const exhaustive: never = voice
      throw new Error(`Unhandled voice: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** Human summary lines, shared by the start brief and `screenci context`. */
export function formatBrandingLines(
  branding: CliBranding,
  samplePath: string | null,
  assetPaths: Record<string, string> = {}
): string[] {
  if (isEmptyBranding(branding) && branding.warnings.length === 0) {
    return ['No organisation branding is set; the SDK defaults apply.']
  }
  const where = (field: BrandingField): string =>
    branding.sources[field] === 'project' ? ' (project override)' : ''
  const lines: string[] = []
  if (branding.backgroundCss !== null) {
    lines.push(
      `- Background: ${branding.backgroundCss}${where('backgroundCss')}`
    )
  }
  if (branding.aspectRatio !== null) {
    lines.push(`- Aspect ratio: ${branding.aspectRatio}${where('aspectRatio')}`)
  }
  if (branding.quality !== null) {
    lines.push(`- Quality: ${branding.quality}${where('quality')}`)
  }
  if (branding.cursorStyle !== null) {
    lines.push(`- Cursor: ${branding.cursorStyle}${where('cursorStyle')}`)
  }
  if (branding.voice !== null) {
    lines.push(
      `- Narration voice: ${describeBrandingVoice(branding.voice, samplePath)}${where('voice')}`
    )
  }
  for (const asset of branding.assets) {
    const where = asset.source === 'project' ? ', project override' : ''
    const saved = assetPaths[asset.name]
    const local = saved !== undefined ? `, saved as ${saved}` : ''
    const guide = asset.guide !== '' ? `: ${firstLine(asset.guide)}` : ''
    lines.push(
      `- Shared asset ${asset.name} (${asset.kind}, ${asset.fileName}${where}${local})${guide}`
    )
  }
  for (const warning of branding.warnings) {
    lines.push(`- Warning: ${warning}`)
  }
  return lines
}

/** A guide collapsed to one line, for a summary bullet or a code comment. */
function firstLine(text: string): string {
  return text.split(/\r?\n/)[0]?.trim() ?? ''
}

/**
 * The code an agent should write to use the shared assets. Assets are
 * referenced by name; the export resolves each to the current file, so this
 * never embeds a path or a hash.
 */
/**
 * A JavaScript identifier for an asset's overlay key. Asset names are
 * `[a-z0-9][a-z0-9-]*`, so a dashed one (`intro-clip`) is not an identifier:
 * emitting it verbatim would hand the agent `intro-clip: {...}` and
 * `overlays.intro-clip()`, neither of which parses. The key is the author's
 * choice anyway; only the `branding:` value has to match the Branding page.
 */
export function overlayKeyForAssetName(assetName: string): string {
  const camel = assetName
    .split('-')
    .filter((part) => part !== '')
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join('')
  if (camel === '') return 'asset'
  // A name may start with a digit, which an identifier may not.
  return /^[0-9]/.test(camel)
    ? `asset${camel.charAt(0).toUpperCase()}${camel.slice(1)}`
    : camel
}

export function brandingAssetsSnippet(branding: CliBranding): string | null {
  if (branding.assets.length === 0) return null
  const declarations: string[] = []
  const uses: string[] = []
  // Two names can collapse onto one key (`intro-clip` and `introclip`), and a
  // duplicate object key would silently drop an overlay.
  const usedKeys = new Set<string>()
  for (const asset of branding.assets) {
    let key = overlayKeyForAssetName(asset.name)
    if (usedKeys.has(key)) {
      let suffix = 2
      while (usedKeys.has(`${key}${suffix}`)) suffix += 1
      key = `${key}${suffix}`
    }
    usedKeys.add(key)
    const guide = firstLine(asset.guide)
    if (guide !== '') declarations.push(`    // ${guide}`)
    declarations.push(
      asset.kind === 'image'
        ? `    ${key}: { branding: ${JSON.stringify(asset.name)}, fill: 'recording' },`
        : `    ${key}: { branding: ${JSON.stringify(asset.name)}, fill: 'screen' },`
    )
    uses.push(
      asset.kind === 'image'
        ? `  await overlays.${key}.for(3000)`
        : `  await overlays.${key}()`
    )
  }
  return [
    "import { video } from 'screenci'",
    '',
    'video.overlays({',
    ...declarations,
    `})('<video title>', async ({ page, overlays }) => {`,
    ...uses,
    '})',
  ].join('\n')
}
