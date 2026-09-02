import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, posix, resolve, sep } from 'node:path'

/**
 * Source bundles: the text files of a `screenci/` island (config plus
 * `recordings/**`) that a service-managed project uploads before every
 * preview and export, and that `screenci start` pulls onto a fresh machine.
 *
 * Canonical form (shared with the backend, which validates and re-hashes it;
 * the backend's sourceBundle.test.ts carries the same fixture vector):
 *
 *   canonical = { files: [{ path, content }] } sorted by path using plain
 *   code-unit comparison; hash = sha256(JSON.stringify(canonical)), lowercase hex.
 *
 * Everything here takes an injected filesystem so it is unit-testable without
 * touching the disk.
 */

export interface SourceBundleFile {
  /** Island-relative POSIX path. */
  path: string
  content: string
}

export interface SourceBundle {
  files: SourceBundleFile[]
  hash: string
  byteSize: number
  fileCount: number
}

export type SourceBundleSkipReason = 'too-large' | 'total-cap' | 'binary'

export interface SourceBundleSkip {
  path: string
  reason: SourceBundleSkipReason
}

export interface CollectSourceBundleResult {
  bundle: SourceBundle
  skipped: SourceBundleSkip[]
}

export interface SourceBundleDirent {
  name: string
  isDirectory(): boolean
  isFile(): boolean
}

export interface SourceBundleFs {
  readdir(dir: string): Promise<SourceBundleDirent[]>
  readFile(path: string): Promise<Buffer>
  writeFile(path: string, data: string): Promise<void>
  mkdir(dir: string, options: { recursive: true }): Promise<unknown>
  exists(path: string): Promise<boolean>
}

export const nodeSourceBundleFs: SourceBundleFs = {
  readdir: (dir) => readdir(dir, { withFileTypes: true }),
  readFile: (path) => readFile(path),
  writeFile: (path, data) => writeFile(path, data),
  mkdir: (dir, options) => mkdir(dir, options),
  exists: async (path) => {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  },
}

export interface SourceBundleLimits {
  maxFileBytes: number
  maxTotalBytes: number
  maxFiles: number
}

export const DEFAULT_SOURCE_BUNDLE_LIMITS: SourceBundleLimits = {
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
  maxFiles: 500,
}

/**
 * Dotfiles at the island root that belong in a bundle; every other dotfile
 * and every dot-directory (`.auth/`, `.cache/`, ...) is left out, since those
 * are where tools keep local state and credentials.
 */
export const SOURCE_BUNDLE_DOTFILES: readonly string[] = [
  '.prettierrc',
  '.prettierignore',
  '.gitignore',
  '.yarnrc.yml',
  '.npmrc',
]

const SKIP_DIRS = new Set([
  'node_modules',
  '.screenci',
  '.git',
  'dist',
  'exports',
  'test-results',
  'playwright-report',
  'blob-report',
  '.playwright-cli',
])

const SKIP_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  '.DS_Store',
])

/**
 * Binary overlay / audio media never belongs in a bundle: the service reuses
 * previously uploaded assets by hash (see the asset upload path), so a pulled
 * island records fine without them. Mirrors init's gitignore list.
 */
export const SOURCE_BUNDLE_MEDIA_EXTENSIONS: readonly string[] = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
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
  'zip',
]

/** Name of the ignore file honored when collecting (the island's own). */
export const SOURCE_BUNDLE_IGNORE_FILE = '.gitignore'

type IgnoreRule = { regex: RegExp; dirOnly: boolean }

function globToRegexSource(glob: string): string {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!
    if (char === '*') {
      if (glob[i + 1] === '*') {
        out += '.*'
        i += 1
        if (glob[i + 1] === '/') i += 1
      } else {
        out += '[^/]*'
      }
    } else if (char === '?') {
      out += '[^/]'
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return out
}

/**
 * The subset of gitignore syntax worth honoring here: comments, blank lines,
 * `dir/` (directory only), anchored patterns (containing a slash), and
 * unanchored names/globs matched against any path segment. Negations are
 * ignored (a negated file simply stays included by the default rules).
 */
export function parseIgnoreRules(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue
    const dirOnly = line.endsWith('/')
    let pattern = dirOnly ? line.slice(0, -1) : line
    const anchored = pattern.startsWith('/') || pattern.includes('/')
    if (pattern.startsWith('/')) pattern = pattern.slice(1)
    if (pattern === '') continue
    const source = globToRegexSource(pattern)
    const regex = anchored
      ? new RegExp(`^${source}(/.*)?$`)
      : new RegExp(`(^|/)${source}(/.*)?$`)
    rules.push({ regex, dirOnly })
  }
  return rules
}

function isIgnored(
  rules: readonly IgnoreRule[],
  relativePath: string,
  isDirectory: boolean
): boolean {
  return rules.some(
    (rule) => (!rule.dirOnly || isDirectory) && rule.regex.test(relativePath)
  )
}

const BINARY_SNIFF_BYTES = 8 * 1024

function isEnvFileName(name: string): boolean {
  return name === '.env' || name.startsWith('.env.')
}

function hasMediaExtension(name: string): boolean {
  const extension = extname(name).slice(1).toLowerCase()
  return (
    extension.length > 0 && SOURCE_BUNDLE_MEDIA_EXTENSIONS.includes(extension)
  )
}

function looksBinary(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, BINARY_SNIFF_BYTES)
  return sample.includes(0)
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function toPosix(relativePath: string): string {
  return relativePath.split(sep).join(posix.sep)
}

/** Refuses paths that could escape the island; server data is untrusted. */
export function assertSafeBundlePath(path: string): void {
  if (path.length === 0) throw new Error('Source bundle path is empty')
  if (path.includes('\\')) {
    throw new Error(`Source bundle path uses backslashes: ${path}`)
  }
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new Error(`Source bundle path is absolute: ${path}`)
  }
  const segments = path.split('/')
  if (
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..'
    )
  ) {
    throw new Error(`Source bundle path is not island-relative: ${path}`)
  }
}

/** Canonical JSON of the sorted file list, exactly what the server stores. */
export function serializeSourceBundleFiles(files: SourceBundleFile[]): string {
  const sorted = [...files]
    .map((file) => ({ path: file.path, content: file.content }))
    .sort((a, b) => compareCodeUnits(a.path, b.path))
  return JSON.stringify({ files: sorted })
}

export function hashSourceBundleFiles(files: SourceBundleFile[]): string {
  return createHash('sha256')
    .update(serializeSourceBundleFiles(files))
    .digest('hex')
}

/**
 * Collects the island's text sources. Never throws on a skipped file: over-cap
 * and binary files are reported in `skipped` so the caller can warn.
 */
export async function collectSourceBundle(
  islandDir: string,
  fs: SourceBundleFs,
  limits: SourceBundleLimits = DEFAULT_SOURCE_BUNDLE_LIMITS
): Promise<CollectSourceBundleResult> {
  const ignoreRules = await readIgnoreRules(islandDir, fs)
  const candidates: string[] = []

  // Walk the whole island so helper modules the recordings import from
  // outside `recordings/` travel too; the skip lists and the island's own
  // ignore file keep tool state, dependencies and credentials out.
  const walk = async (relativeDir: string): Promise<void> => {
    let entries: SourceBundleDirent[]
    try {
      entries = await fs.readdir(
        relativeDir === '' ? islandDir : resolve(islandDir, relativeDir)
      )
    } catch {
      return
    }
    const sorted = [...entries].sort((a, b) => compareCodeUnits(a.name, b.name))
    for (const entry of sorted) {
      const relativePath =
        relativeDir === '' ? entry.name : posix.join(relativeDir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        if (isIgnored(ignoreRules, relativePath, true)) continue
        await walk(relativePath)
        continue
      }
      if (!entry.isFile()) continue
      if (SKIP_FILES.has(entry.name) || isEnvFileName(entry.name)) continue
      if (
        entry.name.startsWith('.') &&
        !SOURCE_BUNDLE_DOTFILES.includes(entry.name)
      ) {
        continue
      }
      if (isIgnored(ignoreRules, relativePath, false)) continue
      candidates.push(relativePath)
    }
  }
  await walk('')

  const files: SourceBundleFile[] = []
  const skipped: SourceBundleSkip[] = []
  let capReached = false
  for (const relativePath of [...candidates].sort(compareCodeUnits)) {
    if (files.length >= limits.maxFiles) {
      capReached = true
    }
    if (capReached) {
      skipped.push({ path: relativePath, reason: 'total-cap' })
      continue
    }
    if (hasMediaExtension(relativePath)) {
      skipped.push({ path: relativePath, reason: 'binary' })
      continue
    }
    const bytes = await fs.readFile(resolve(islandDir, toNative(relativePath)))
    if (looksBinary(bytes)) {
      skipped.push({ path: relativePath, reason: 'binary' })
      continue
    }
    if (bytes.byteLength > limits.maxFileBytes) {
      skipped.push({ path: relativePath, reason: 'too-large' })
      continue
    }
    files.push({ path: relativePath, content: bytes.toString('utf-8') })
  }

  // The service caps the serialized canonical JSON (what it stores), so the
  // cap is measured on that form here too: files are dropped from the end
  // of the sorted list until the bundle fits, and reported as total-cap.
  let serialized = serializeSourceBundleFiles(files)
  while (
    files.length > 0 &&
    Buffer.byteLength(serialized) > limits.maxTotalBytes
  ) {
    const dropped = files.pop()!
    skipped.push({ path: dropped.path, reason: 'total-cap' })
    serialized = serializeSourceBundleFiles(files)
  }
  skipped.sort((a, b) => compareCodeUnits(a.path, b.path))

  return {
    bundle: {
      files: JSON.parse(serialized).files as SourceBundleFile[],
      hash: createHash('sha256').update(serialized).digest('hex'),
      byteSize: Buffer.byteLength(serialized),
      fileCount: files.length,
    },
    skipped,
  }
}

async function readIgnoreRules(
  islandDir: string,
  fs: SourceBundleFs
): Promise<IgnoreRule[]> {
  const ignorePath = resolve(islandDir, SOURCE_BUNDLE_IGNORE_FILE)
  if (!(await fs.exists(ignorePath))) return []
  try {
    return parseIgnoreRules((await fs.readFile(ignorePath)).toString('utf-8'))
  } catch {
    return []
  }
}

function toNative(relativePosixPath: string): string {
  return relativePosixPath.split(posix.sep).join(sep)
}

export interface SourceBundleApplyPlan {
  /** Absent locally: written. */
  write: string[]
  /** Identical locally: left alone. */
  unchanged: string[]
  /** Differs locally: only written with `force`. */
  conflicts: string[]
}

/** Pure diff of a bundle against the local contents (`null` = absent). */
export function planSourceBundleApply(
  files: readonly SourceBundleFile[],
  localFiles: ReadonlyMap<string, string | null>
): SourceBundleApplyPlan {
  const plan: SourceBundleApplyPlan = {
    write: [],
    unchanged: [],
    conflicts: [],
  }
  for (const file of files) {
    const local = localFiles.get(file.path) ?? null
    if (local === null) plan.write.push(file.path)
    else if (local === file.content) plan.unchanged.push(file.path)
    else plan.conflicts.push(file.path)
  }
  return plan
}

export type ApplySourceBundleResult =
  | { ok: true; written: string[]; unchanged: string[]; overwritten: string[] }
  | { ok: false; conflicts: string[] }

/**
 * Writes a pulled bundle into the island. With conflicts and no `force`,
 * writes nothing and reports them; with `force`, conflicting files are
 * overwritten. Never deletes local files the bundle does not mention.
 */
export async function applySourceBundle(
  islandDir: string,
  files: readonly SourceBundleFile[],
  fs: SourceBundleFs,
  options: { force: boolean }
): Promise<ApplySourceBundleResult> {
  for (const file of files) assertSafeBundlePath(file.path)

  const localFiles = new Map<string, string | null>()
  for (const file of files) {
    const target = resolve(islandDir, toNative(file.path))
    if (!(await fs.exists(target))) {
      localFiles.set(file.path, null)
      continue
    }
    localFiles.set(file.path, (await fs.readFile(target)).toString('utf-8'))
  }
  const plan = planSourceBundleApply(files, localFiles)
  if (plan.conflicts.length > 0 && !options.force) {
    return { ok: false, conflicts: plan.conflicts }
  }

  const toWrite = new Set([...plan.write, ...plan.conflicts])
  for (const file of files) {
    if (!toWrite.has(file.path)) continue
    const target = resolve(islandDir, toNative(file.path))
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.writeFile(target, file.content)
  }
  return {
    ok: true,
    written: plan.write,
    unchanged: plan.unchanged,
    overwritten: plan.conflicts,
  }
}

/** Parses the bundle JSON the server serves (shape-checked, paths validated). */
export function parseSourceBundleFiles(raw: unknown): SourceBundleFile[] {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as { files?: unknown }).files)
  ) {
    throw new Error('Source bundle response is malformed')
  }
  const files = (raw as { files: unknown[] }).files.map((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { path?: unknown }).path !== 'string' ||
      typeof (entry as { content?: unknown }).content !== 'string'
    ) {
      throw new Error('Source bundle response is malformed')
    }
    const file = entry as SourceBundleFile
    assertSafeBundlePath(file.path)
    return { path: file.path, content: file.content }
  })
  return files
}

/** Human-readable island-relative display path (POSIX). */
export function displayBundlePath(path: string): string {
  return toPosix(path)
}
