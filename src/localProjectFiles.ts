import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, posix, resolve, sep } from 'node:path'
import {
  classifyProjectFile,
  isProjectMediaPath,
  isValidVideoSlug,
  maxProjectFileBytes,
  projectFilePathProblem,
  RECORDINGS_DIR,
  ROOT_PROJECT_FILES,
  selectProjectFiles,
  SHARED_DIR,
  type ManifestEntry,
} from './projectFiles.js'

/**
 * The island's project files on disk: collecting the files a set of videos
 * needs (for per-file storage and the drift check) and writing pulled files
 * back (for `screenci setup` and the hosted runner).
 *
 * A file's identity is the sha256 hex of its raw bytes, the same hash the
 * service stores it under, so "already stored" and "unchanged locally" are a
 * hash comparison. Everything takes an injected filesystem.
 */

export interface ProjectFilesDirent {
  name: string
  isDirectory(): boolean
  isFile(): boolean
}

export interface ProjectFilesFs {
  readdir(dir: string): Promise<ProjectFilesDirent[]>
  readFile(path: string): Promise<Buffer>
  writeFile(path: string, data: string | Uint8Array): Promise<void>
  mkdir(dir: string, options: { recursive: true }): Promise<unknown>
  exists(path: string): Promise<boolean>
}

export const nodeProjectFilesFs: ProjectFilesFs = {
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

/** sha256 hex (lowercase) of the raw bytes: a stored file's identity. */
export function hashProjectFileBytes(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** A file read from the island, ready to hash-check and upload. */
export interface LocalProjectFile {
  /** Island-relative POSIX path. */
  path: string
  hash: string
  byteSize: number
  bytes: Buffer
}

export type LocalProjectFileSkipReason = 'too-large'

export interface LocalProjectFileSkip {
  path: string
  reason: LocalProjectFileSkipReason
}

export interface CollectProjectFilesResult {
  /** Sorted by path. */
  files: LocalProjectFile[]
  skipped: LocalProjectFileSkip[]
}

/** Name of the ignore file honored when collecting (the island's own). */
export const PROJECT_FILES_IGNORE_FILE = '.gitignore'

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

export function isIgnoredPath(
  rules: readonly IgnoreRule[],
  relativePath: string,
  isDirectory: boolean
): boolean {
  return rules.some(
    (rule) => (!rule.dirOnly || isDirectory) && rule.regex.test(relativePath)
  )
}

/** Refuses paths that could escape the island; server data is untrusted. */
export function assertSafeRelativePath(path: string): void {
  if (path.length === 0) throw new Error('Project file path is empty')
  if (path.includes('\\')) {
    throw new Error(`Project file path uses backslashes: ${path}`)
  }
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new Error(`Project file path is absolute: ${path}`)
  }
  const segments = path.split('/')
  if (
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..'
    )
  ) {
    throw new Error(`Project file path is not island-relative: ${path}`)
  }
}

/**
 * Refuses a path that is not a storable project file (which also covers
 * traversal, env files and signed-in session files). Every writer re-checks
 * paths that came from the service.
 */
export function assertStorableProjectPath(path: string): void {
  assertSafeRelativePath(path)
  const problem = projectFilePathProblem(path)
  if (problem !== null) {
    throw new Error(`Refusing project file "${path}": ${problem}`)
  }
}

function toNative(relativePosixPath: string): string {
  return relativePosixPath.split(posix.sep).join(sep)
}

export function projectFileAbsolutePath(
  islandDir: string,
  relativePosixPath: string
): string {
  return resolve(islandDir, toNative(relativePosixPath))
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

async function readIgnoreRules(
  islandDir: string,
  fs: ProjectFilesFs
): Promise<IgnoreRule[]> {
  const ignorePath = resolve(islandDir, PROJECT_FILES_IGNORE_FILE)
  if (!(await fs.exists(ignorePath))) return []
  try {
    return parseIgnoreRules((await fs.readFile(ignorePath)).toString('utf-8'))
  } catch {
    return []
  }
}

/**
 * Collects the files the given videos need from the island on disk: the root
 * files that exist, everything under `recordings/shared/`, and each video's
 * script and `recordings/<slug>/` folder (see selectProjectFiles).
 *
 * The island's `.gitignore` is honored for text files only: the scaffolded
 * `.gitignore` leaves media under `recordings/` out of git precisely because
 * ScreenCI stores it, so media is always collected. Paths that can never be
 * stored (env files, signed-in sessions, hidden files, `node_modules`, ...)
 * are left out silently; files over the per-file cap are reported.
 */
export async function collectProjectFiles(
  islandDir: string,
  slugs: readonly string[],
  fs: ProjectFilesFs
): Promise<CollectProjectFilesResult> {
  const ignoreRules = await readIgnoreRules(islandDir, fs)
  const candidates = new Set<string>()

  const consider = (relativePath: string): void => {
    if (projectFilePathProblem(relativePath) !== null) return
    if (
      !isProjectMediaPath(relativePath) &&
      isIgnoredPath(ignoreRules, relativePath, false)
    ) {
      return
    }
    candidates.add(relativePath)
  }

  const listDir = async (
    relativeDir: string
  ): Promise<ProjectFilesDirent[]> => {
    try {
      return await fs.readdir(projectFileAbsolutePath(islandDir, relativeDir))
    } catch {
      return []
    }
  }

  const walk = async (relativeDir: string): Promise<void> => {
    const entries = [...(await listDir(relativeDir))].sort((a, b) =>
      compareCodeUnits(a.name, b.name)
    )
    for (const entry of entries) {
      const relativePath = posix.join(relativeDir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue
        if (projectFilePathProblem(`${relativePath}/x.ts`) !== null) continue
        if (isIgnoredPath(ignoreRules, relativePath, true)) {
          // A whole ignored folder may still hold media ScreenCI stores.
          await walkMediaOnly(relativePath)
          continue
        }
        await walk(relativePath)
        continue
      }
      if (entry.isFile()) consider(relativePath)
    }
  }

  const walkMediaOnly = async (relativeDir: string): Promise<void> => {
    for (const entry of await listDir(relativeDir)) {
      const relativePath = posix.join(relativeDir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue
        await walkMediaOnly(relativePath)
      } else if (entry.isFile() && isProjectMediaPath(relativePath)) {
        consider(relativePath)
      }
    }
  }

  for (const name of ROOT_PROJECT_FILES) {
    if (await fs.exists(projectFileAbsolutePath(islandDir, name))) {
      consider(name)
    }
  }
  await walk(SHARED_DIR)
  // Slugs may come from the service: only valid ones name a folder to walk.
  const wanted = new Set(slugs.filter(isValidVideoSlug))
  for (const entry of await listDir(RECORDINGS_DIR)) {
    if (!entry.isFile()) continue
    const relativePath = `${RECORDINGS_DIR}/${entry.name}`
    const fileClass = classifyProjectFile(relativePath)
    if (fileClass?.kind === 'script' && wanted.has(fileClass.slug)) {
      consider(relativePath)
    }
  }
  for (const slug of [...wanted].sort(compareCodeUnits)) {
    await walk(`${RECORDINGS_DIR}/${slug}`)
  }

  const files: LocalProjectFile[] = []
  const skipped: LocalProjectFileSkip[] = []
  for (const relativePath of [
    ...selectProjectFiles(
      [...candidates].map((path) => ({ path })),
      [...wanted]
    ),
  ]
    .map((entry) => entry.path)
    .sort(compareCodeUnits)) {
    let bytes: Buffer
    try {
      bytes = await fs.readFile(
        projectFileAbsolutePath(islandDir, relativePath)
      )
    } catch {
      // A directory entry that is not a readable file (or vanished): skip.
      continue
    }
    if (bytes.byteLength > maxProjectFileBytes(relativePath)) {
      skipped.push({ path: relativePath, reason: 'too-large' })
      continue
    }
    files.push({
      path: relativePath,
      hash: hashProjectFileBytes(bytes),
      byteSize: bytes.byteLength,
      bytes,
    })
  }
  return { files, skipped }
}

export function toManifest(
  files: readonly { path: string; hash: string }[]
): ManifestEntry[] {
  return files.map((file) => ({ path: file.path, hash: file.hash }))
}

/** Hash of each path's local bytes, or null when the file is absent. */
export async function readLocalHashes(
  islandDir: string,
  paths: readonly string[],
  fs: ProjectFilesFs
): Promise<Map<string, string | null>> {
  const hashes = new Map<string, string | null>()
  for (const path of paths) {
    const target = projectFileAbsolutePath(islandDir, path)
    if (!(await fs.exists(target))) {
      hashes.set(path, null)
      continue
    }
    try {
      hashes.set(path, hashProjectFileBytes(await fs.readFile(target)))
    } catch {
      hashes.set(path, null)
    }
  }
  return hashes
}

export interface ProjectFilesApplyPlan {
  /** Absent locally: written. */
  write: string[]
  /** Identical locally: left alone. */
  unchanged: string[]
  /** Differs locally: only written with `force`. */
  conflicts: string[]
}

/** Pure diff of pulled entries against the local hashes (`null` = absent). */
export function planProjectFilesApply(
  entries: readonly ManifestEntry[],
  localHashes: ReadonlyMap<string, string | null>
): ProjectFilesApplyPlan {
  const plan: ProjectFilesApplyPlan = {
    write: [],
    unchanged: [],
    conflicts: [],
  }
  for (const entry of entries) {
    const local = localHashes.get(entry.path) ?? null
    if (local === null) plan.write.push(entry.path)
    else if (local === entry.hash) plan.unchanged.push(entry.path)
    else plan.conflicts.push(entry.path)
  }
  return plan
}

export type ApplyProjectFilesResult =
  | { ok: true; written: string[]; unchanged: string[]; overwritten: string[] }
  | { ok: false; conflicts: string[] }

/** Fetches one stored file's bytes by its hash. */
export type FetchProjectFileBlob = (hash: string) => Promise<Uint8Array>

/**
 * Writes pulled files into the island, fetching only the files whose local
 * hash differs. With conflicts and no `force`, writes nothing and reports
 * them; with `force`, conflicting files are overwritten. Never deletes local
 * files the entries do not mention. Fetched bytes must hash to the entry's
 * hash, so a wrong or tampered blob is refused rather than written.
 */
export async function applyProjectFiles(
  islandDir: string,
  entries: readonly ManifestEntry[],
  fetchBlob: FetchProjectFileBlob,
  fs: ProjectFilesFs,
  options: { force: boolean }
): Promise<ApplyProjectFilesResult> {
  for (const entry of entries) assertStorableProjectPath(entry.path)

  const localHashes = await readLocalHashes(
    islandDir,
    entries.map((entry) => entry.path),
    fs
  )
  const plan = planProjectFilesApply(entries, localHashes)
  if (plan.conflicts.length > 0 && !options.force) {
    return { ok: false, conflicts: plan.conflicts }
  }

  const toWrite = new Set([...plan.write, ...plan.conflicts])
  const fetched = new Map<string, Uint8Array>()
  for (const entry of entries) {
    if (!toWrite.has(entry.path)) continue
    let bytes = fetched.get(entry.hash)
    if (bytes === undefined) {
      bytes = await fetchBlob(entry.hash)
      if (hashProjectFileBytes(bytes) !== entry.hash) {
        throw new Error(
          `The stored copy of ${entry.path} does not match its hash; nothing more was written.`
        )
      }
      fetched.set(entry.hash, bytes)
    }
    const target = projectFileAbsolutePath(islandDir, entry.path)
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.writeFile(target, bytes)
  }
  return {
    ok: true,
    written: plan.write,
    unchanged: plan.unchanged,
    overwritten: plan.conflicts,
  }
}
