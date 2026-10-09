/**
 * Project files: how a ScreenCI island is stored server-side, one file at a
 * time, so an edit, a pull or a hosted run touches only the files it needs.
 *
 * Layout convention (island-relative POSIX paths):
 *
 *   screenci.config.ts, package.json, tsconfig.json, lockfiles   root (developer-only)
 *   recordings/<slug>.screenci.ts                               one video per file
 *   recordings/<slug>/...                                       that video's own files (optional)
 *   recordings/shared/...                                       files many videos use
 *
 * "The files video X needs" is: every root file, everything under
 * `recordings/shared/`, the script `recordings/<X>.screenci.*` and everything
 * under `recordings/<X>/`. No import analysis: the folder convention is the
 * contract.
 *
 * The service applies the same rules (its copy lives next to the web app);
 * this copy keeps the CLI self-contained. Keep both in sync and keep their
 * test vectors identical (projectFiles.spec.ts).
 */

export const RECORDINGS_DIR = 'recordings'
export const SHARED_DIR_NAME = 'shared'
export const SHARED_DIR = `${RECORDINGS_DIR}/${SHARED_DIR_NAME}`

/**
 * Island-root files that are stored. Everything here changes what code runs or
 * which dependencies install, so only developers may edit them. `.npmrc` is
 * deliberately absent: it can carry registry auth tokens.
 */
export const ROOT_PROJECT_FILES: readonly string[] = [
  'screenci.config.ts',
  'package.json',
  'tsconfig.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  '.yarnrc.yml',
  'bun.lock',
  '.prettierrc',
  '.gitignore',
  'README.md',
]

export type ProjectFileKind = 'root' | 'script' | 'video-file' | 'shared'

export type ProjectFileClass =
  | { kind: 'root' }
  | { kind: 'script'; slug: string }
  | { kind: 'video-file'; slug: string }
  | { kind: 'shared' }

/** Largest stored text file (scripts, overlays, config). */
export const MAX_PROJECT_TEXT_FILE_BYTES = 1024 * 1024
/** Largest stored media file (images, video, audio, fonts). */
export const MAX_PROJECT_MEDIA_FILE_BYTES = 10 * 1024 * 1024
export const MAX_PROJECT_FILE_PATH_LENGTH = 300

export const PROJECT_MEDIA_EXTENSIONS: readonly string[] = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'mp4',
  'mov',
  'webm',
  'mp3',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'flac',
  'opus',
  'ico',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'pdf',
]

const SCRIPT_FILE_PATTERN = /^recordings\/([^/]+)\.screenci\.[cm]?[jt]sx?$/

/** A video slug: the script's basename without `.screenci.<ext>`. */
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

const FORBIDDEN_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.screenci',
  'dist',
  'exports',
  'test-results',
  'playwright-report',
  'blob-report',
  '.playwright-cli',
])

export function isValidVideoSlug(slug: string): boolean {
  return (
    SLUG_PATTERN.test(slug) &&
    slug !== SHARED_DIR_NAME &&
    !slug.endsWith('.') &&
    !slug.includes('..')
  )
}

function isEnvFileName(name: string): boolean {
  return name === '.env' || name.startsWith('.env.')
}

function isStorageStateFileName(name: string): boolean {
  return /storage[-_]?state[^/]*\.json$/i.test(name)
}

export function projectFileExtension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function isProjectMediaPath(path: string): boolean {
  return PROJECT_MEDIA_EXTENSIONS.includes(projectFileExtension(path))
}

export function maxProjectFileBytes(path: string): number {
  return isProjectMediaPath(path)
    ? MAX_PROJECT_MEDIA_FILE_BYTES
    : MAX_PROJECT_TEXT_FILE_BYTES
}

/**
 * Why a path can never be stored, or null when it is safe. Server-side data is
 * untrusted on every reader, so the CLI and the runner re-check paths before
 * writing them to disk.
 */
export function projectFilePathProblem(path: string): string | null {
  if (path.length === 0) return 'Path is empty.'
  if (path.length > MAX_PROJECT_FILE_PATH_LENGTH) {
    return `Path is longer than ${MAX_PROJECT_FILE_PATH_LENGTH} characters.`
  }
  if (path.includes('\\')) return 'Path uses backslashes; use forward slashes.'
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return 'Path must be relative to the project root.'
  }

  if (/[\u0000-\u001f]/.test(path)) return 'Path contains control characters.'
  const segments = path.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      return 'Path must not contain empty, "." or ".." segments.'
    }
    if (FORBIDDEN_SEGMENTS.has(segment)) {
      return `Path must not go through "${segment}".`
    }
  }
  const name = segments[segments.length - 1]!
  if (isEnvFileName(name)) {
    return 'Env files are never stored; set environment variables in the project settings instead.'
  }
  if (isStorageStateFileName(name)) {
    return 'Signed-in session files are never stored.'
  }
  if (segments.length === 1) {
    return ROOT_PROJECT_FILES.includes(name)
      ? null
      : `Only these files are stored at the project root: ${ROOT_PROJECT_FILES.join(', ')}.`
  }
  if (segments[0] !== RECORDINGS_DIR) {
    return `Files must live under ${RECORDINGS_DIR}/ (or be one of the root files).`
  }
  if (segments.slice(1).some((segment) => segment.startsWith('.'))) {
    return 'Hidden files and folders are not stored.'
  }
  if (segments.length === 2) {
    const match = SCRIPT_FILE_PATTERN.exec(path)
    if (match === null) {
      return `A file directly in ${RECORDINGS_DIR}/ must be a video script named <name>.screenci.ts; put other files in ${SHARED_DIR}/ or ${RECORDINGS_DIR}/<video>/.`
    }
    return isValidVideoSlug(match[1]!)
      ? null
      : 'Video file names may use letters, digits, ".", "-" and "_" (and must not be "shared").'
  }
  const folder = segments[1]!
  if (folder !== SHARED_DIR_NAME && !isValidVideoSlug(folder)) {
    return 'Video folder names may use letters, digits, ".", "-" and "_".'
  }
  return null
}

/** Classifies a valid path; null for a path that is never stored. */
export function classifyProjectFile(path: string): ProjectFileClass | null {
  if (projectFilePathProblem(path) !== null) return null
  const segments = path.split('/')
  if (segments.length === 1) return { kind: 'root' }
  if (segments.length === 2) {
    const match = SCRIPT_FILE_PATTERN.exec(path)
    return match === null ? null : { kind: 'script', slug: match[1]! }
  }
  const folder = segments[1]!
  return folder === SHARED_DIR_NAME
    ? { kind: 'shared' }
    : { kind: 'video-file', slug: folder }
}

export function videoSlugOf(path: string): string | null {
  const fileClass = classifyProjectFile(path)
  if (fileClass === null) return null
  switch (fileClass.kind) {
    case 'script':
    case 'video-file':
      return fileClass.slug
    case 'root':
    case 'shared':
      return null
    default: {
      const exhaustive: never = fileClass
      return exhaustive
    }
  }
}

/** Root files change what installs and runs: developers only. */
export function isDeveloperOnlyProjectFile(path: string): boolean {
  const fileClass = classifyProjectFile(path)
  if (fileClass === null) return true
  switch (fileClass.kind) {
    case 'root':
      return true
    case 'script':
    case 'video-file':
    case 'shared':
      return false
    default: {
      const exhaustive: never = fileClass
      return exhaustive
    }
  }
}

export function scriptPathForSlug(slug: string, extension = 'ts'): string {
  return `${RECORDINGS_DIR}/${slug}.screenci.${extension}`
}

/** A file-name-safe slug from a video title ("Add a lead" -> "add-a-lead"). */
export function videoSlugFromTitle(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
  if (slug === '') return 'video-untitled'
  if (slug === SHARED_DIR_NAME) return 'video-shared'
  return slug
}

/**
 * The files the given videos need: root files, shared files, and each video's
 * own script and folder. Order follows the input.
 */
export function selectProjectFiles<T extends { path: string }>(
  entries: readonly T[],
  slugs: readonly string[]
): T[] {
  const wanted = new Set(slugs)
  return entries.filter((entry) => {
    const fileClass = classifyProjectFile(entry.path)
    if (fileClass === null) return false
    switch (fileClass.kind) {
      case 'root':
      case 'shared':
        return true
      case 'script':
      case 'video-file':
        return wanted.has(fileClass.slug)
      default: {
        const exhaustive: never = fileClass
        return exhaustive
      }
    }
  })
}

/** Strips comments so commented-out videos are not counted. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

const TITLE_CALL_PATTERN =
  /(?:\b(?:video|screenshot)|\))\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*(?:async\b|function\b|\()/g

/**
 * The video and screenshot titles a script declares: `video('Title', ...)`,
 * `screenshot('Title', ...)` and builder chains ending in
 * `...)('Title', async ...)`. `video.describe(...)` groups are not titles. A
 * heuristic (no TypeScript parser): good enough to enforce "one video per
 * file" on uploads and to name the video a script belongs to.
 */
export function extractVideoTitles(source: string): string[] {
  const titles: string[] = []
  for (const match of stripComments(source).matchAll(TITLE_CALL_PATTERN)) {
    titles.push(match[2]!.replace(/\\(.)/g, '$1'))
  }
  return titles
}

export type ScriptTitleCheck =
  | { ok: true; title: string }
  | { ok: false; reason: 'none' | 'several'; titles: string[] }

/** One video per stored script file. */
export function checkSingleVideoScript(source: string): ScriptTitleCheck {
  const titles = extractVideoTitles(source)
  if (titles.length === 1) return { ok: true, title: titles[0]! }
  return { ok: false, reason: titles.length === 0 ? 'none' : 'several', titles }
}

export type ManifestEntry = { path: string; hash: string }

export type ManifestDiff = {
  /** Present on both sides with different content. */
  changed: string[]
  /** Only in `remote`. */
  onlyRemote: string[]
  /** Only in `local`. */
  onlyLocal: string[]
}

/** Path-level diff of two manifests (sorted output). */
export function diffManifests(
  local: readonly ManifestEntry[],
  remote: readonly ManifestEntry[]
): ManifestDiff {
  const localByPath = new Map(local.map((entry) => [entry.path, entry.hash]))
  const remoteByPath = new Map(remote.map((entry) => [entry.path, entry.hash]))
  const changed: string[] = []
  const onlyRemote: string[] = []
  const onlyLocal: string[] = []
  for (const [path, hash] of remoteByPath) {
    const localHash = localByPath.get(path)
    if (localHash === undefined) onlyRemote.push(path)
    else if (localHash !== hash) changed.push(path)
  }
  for (const path of localByPath.keys()) {
    if (!remoteByPath.has(path)) onlyLocal.push(path)
  }
  return {
    changed: changed.sort(),
    onlyRemote: onlyRemote.sort(),
    onlyLocal: onlyLocal.sort(),
  }
}

export function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value)
}
