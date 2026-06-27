/**
 * A render dependency declared via `selected(name)`: the `from` render embeds the
 * `to` render's output as an overlay. Used for best-effort registration-time
 * warnings; the authoritative existence/one-level/medium checks run on the
 * backend at upload (it sees every file and language).
 */
export type DependencyReference = {
  /** Name of the dependent video/screenshot (the one declaring `selected`). */
  from: string
  /** Name referenced via `selected(name)` (the embedded target). */
  to: string
}

/**
 * Videos and screenshots share a single name namespace within a run (both are
 * rows in the same table, addressed by `selected(name)`). Titles must therefore
 * be unique across BOTH mediums, not just within one. {@link findDuplicateTitles}
 * already enforces this because every video and screenshot title is collected
 * into the same list before checking, so a name reused across mediums surfaces as
 * a duplicate.
 */
export function findDuplicateTitles(titles: readonly string[]): string[] {
  const counts = new Map<string, number>()

  for (const title of titles) {
    counts.set(title, (counts.get(title) ?? 0) + 1)
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([title]) => title)
}

export function formatDuplicateTitlesMessage(
  duplicates: readonly string[]
): string {
  const lines = [
    'Duplicate test titles detected. Titles must be exactly unique:',
  ]

  for (const title of duplicates) {
    lines.push(`  - "${title}"`)
  }

  return lines.join('\n')
}

/**
 * Returns the dependency references that point at themselves (`from === to`). A
 * render cannot embed its own output, so these are always a mistake.
 */
export function findSelfReferences(
  references: readonly DependencyReference[]
): DependencyReference[] {
  return references.filter((ref) => ref.from === ref.to)
}

/**
 * Returns the dependency references whose target (`to`) is not among the
 * `knownTitles` discovered in the run. This is a best-effort warning: a target
 * may legitimately live in another file not part of this discovery, so the
 * authoritative existence check runs on the backend at upload.
 */
export function findMissingReferences(
  references: readonly DependencyReference[],
  knownTitles: readonly string[]
): DependencyReference[] {
  const known = new Set(knownTitles)
  return references.filter((ref) => !known.has(ref.to))
}

/**
 * Formats best-effort registration-time warnings for self-references and
 * obviously missing dependency targets. Returns an empty string when there is
 * nothing to warn about, so callers can skip emitting anything.
 */
export function formatDependencyWarnings(
  selfReferences: readonly DependencyReference[],
  missingReferences: readonly DependencyReference[]
): string {
  const lines: string[] = []
  for (const ref of selfReferences) {
    lines.push(
      `  - "${ref.from}" uses selected("${ref.to}"), which references itself. A render cannot embed its own output.`
    )
  }
  for (const ref of missingReferences) {
    lines.push(
      `  - "${ref.from}" uses selected("${ref.to}"), but no video or screenshot named "${ref.to}" was found in this run.`
    )
  }
  if (lines.length === 0) return ''
  return ['Dependency warnings:', ...lines].join('\n')
}
