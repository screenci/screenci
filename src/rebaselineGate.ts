/**
 * Guards the post-codegen re-baseline against erasing record-requiring
 * changes.
 *
 * Render-time edits (`requiresRecord: false`) re-baseline the kept
 * recordings' source hashes after rewriting a file, so applying them never
 * marks a recording stale. But a record-REQUIRING edit (e.g. the language
 * set) rewrites the same file and must leave it stale until the next record;
 * a render-time edit applied afterwards would re-hash the whole file,
 * language change included, and silently swallow the needed record. The gate
 * remembers which files a record-requiring rewrite touched and excludes them
 * from re-baselines until a record has run.
 */
export type RebaselineGate = {
  /** Note files rewritten by a record-requiring edit: they stay stale. */
  noteRecordRequired: (paths: string[]) => void
  /** The subset of `paths` that may be re-baselined (not record-pending). */
  rebaselinablePaths: (paths: string[]) => string[]
  /** A record ran: its footage covers the sources, so re-baselining is safe
   *  again for every file. */
  clearAfterRecord: () => void
}

export function createRebaselineGate(): RebaselineGate {
  const recordPending = new Set<string>()
  return {
    noteRecordRequired(paths) {
      for (const path of paths) recordPending.add(path)
    },
    rebaselinablePaths(paths) {
      return paths.filter((path) => !recordPending.has(path))
    },
    clearAfterRecord() {
      recordPending.clear()
    },
  }
}
