/**
 * Exact test selection for record passes that must record exactly the named
 * videos (`screenci ci`, the hosted runner, a single-video preview). A title
 * regex (`--grep`) cannot do that: Playwright matches it against the whole
 * space-joined title path, so "Intro" also hits "Product Intro" and
 * "Intro v2". Selecting by source location does not work either: videos
 * declared through a builder chain (`video.narration(...)('Title', ...)`)
 * all report the builder module's location.
 *
 * Instead the tests are listed (`--list --reporter=json`), the ones whose
 * video name equals a wanted name are picked, and Playwright runs exactly
 * those through a `--test-list` file: one line per test naming its file and
 * its full title path, which Playwright compares title by title.
 */

export type RecordSelection =
  /** Every declared video. */
  | { kind: 'all' }
  /** Playwright `--grep` (user-supplied patterns). */
  | { kind: 'grep'; pattern: string }
  /** Exactly the videos with these names. */
  | { kind: 'exact'; titles: readonly string[] }

/** The subset of Playwright's `--list --reporter=json` report used here. */
export type ListReportSpec = { title: string; file?: string }

export type ListReportSuite = {
  title?: string
  file?: string
  specs?: ListReportSpec[]
  suites?: ListReportSuite[]
}

export type ListReport = {
  config?: { rootDir?: string }
  suites?: ListReportSuite[]
}

export type ListedTest = {
  /** The video name: the test title without a per-language ` [xx]` suffix. */
  videoName: string
  /** The script file that declared it (rootDir-relative, as listed). */
  scriptFile: string
  /** The file Playwright reports as the test's location (rootDir-relative). */
  locationFile: string
  /** Describe titles, then the test title. */
  titlePath: string[]
}

/**
 * A per-language pass is titled `<video> [<lang>]`. Language codes are
 * lowercase (ISO 639) with an optional region subtag (pt-BR), so unrelated
 * capitalised brackets like ` [New]` are kept.
 */
export function stripTestTitleLanguageSuffix(title: string): string {
  return title.replace(/ \[[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?\]$/, '')
}

/** Every listed test, with the file and title path a test list needs. */
export function collectListedTests(report: ListReport): ListedTest[] {
  const tests: ListedTest[] = []
  const visit = (
    suite: ListReportSuite,
    scriptFile: string,
    describes: string[]
  ): void => {
    for (const spec of suite.specs ?? []) {
      tests.push({
        videoName: stripTestTitleLanguageSuffix(spec.title),
        scriptFile,
        locationFile: spec.file ?? scriptFile,
        titlePath: [...describes, spec.title],
      })
    }
    for (const child of suite.suites ?? []) {
      // Playwright leaves untitled describes out of the title path.
      const title = child.title ?? ''
      visit(child, scriptFile, title === '' ? describes : [...describes, title])
    }
  }
  // Top-level suites are the script files; nested suites are describes.
  for (const suite of report.suites ?? []) {
    const scriptFile = suite.file ?? suite.title ?? ''
    if (scriptFile !== '') visit(suite, scriptFile, [])
  }
  return tests
}

const TEST_LIST_DELIMITER = ' › '

/**
 * The `--test-list` lines for one test. Playwright loads only the files a
 * line names and matches a test by its location file, so a builder-declared
 * test needs both its script (to load it) and its builder location (to
 * match it); the extra line matches nothing else.
 */
export function testListLines(test: ListedTest): string[] {
  const titles = test.titlePath.join(TEST_LIST_DELIMITER)
  const lines = [`${test.scriptFile}${TEST_LIST_DELIMITER}${titles}`]
  if (test.locationFile !== test.scriptFile) {
    lines.push(`${test.locationFile}${TEST_LIST_DELIMITER}${titles}`)
  }
  return lines
}

/** A title Playwright's test-list format cannot carry exactly. */
function isListable(test: ListedTest): boolean {
  return test.titlePath.every(
    (title) =>
      !title.includes('›') && !title.includes('\n') && title === title.trim()
  )
}

export type ExactSelection = {
  /** `--test-list` lines covering every matching test (deduped). */
  lines: string[]
  /** Wanted names no listed test carries. */
  missing: string[]
  /** Wanted names whose title the test-list format cannot express. */
  unlistable: string[]
}

/** Picks the tests whose video name equals a wanted name exactly. */
export function selectExactTitles(
  tests: readonly ListedTest[],
  titles: readonly string[]
): ExactSelection {
  const wanted = new Set(titles)
  const lines = new Set<string>()
  const found = new Set<string>()
  const unlistable = new Set<string>()
  for (const test of tests) {
    if (!wanted.has(test.videoName)) continue
    found.add(test.videoName)
    if (!isListable(test)) {
      unlistable.add(test.videoName)
      continue
    }
    for (const line of testListLines(test)) lines.add(line)
  }
  return {
    lines: [...lines],
    missing: titles.filter((title) => !found.has(title)),
    unlistable: [...unlistable],
  }
}

export class MissingVideoTitlesError extends Error {
  constructor(readonly titles: readonly string[]) {
    super(
      `No video titled ${titles.map((title) => `"${title}"`).join(', ')} in this workspace (the title must match exactly).`
    )
    this.name = 'MissingVideoTitlesError'
  }
}

export interface RecordSelectionDeps {
  /** The discovery pass (`playwright test --list --reporter=json`). */
  list: () => Promise<ListReport | null>
  /** Writes the test list file and returns its path. */
  writeTestList: (content: string) => Promise<string>
}

/**
 * The Playwright arguments for a selection. Only an exact selection lists
 * the tests and writes a test list; a wanted name without a test throws.
 */
export async function recordSelectionArgs(
  selection: RecordSelection,
  deps: RecordSelectionDeps
): Promise<string[]> {
  switch (selection.kind) {
    case 'all':
      return []
    case 'grep':
      return ['--grep', selection.pattern]
    case 'exact': {
      // An empty test list would record nothing; an empty selection is a
      // caller bug, never "record everything".
      if (selection.titles.length === 0) {
        throw new Error('No videos were selected to record.')
      }
      const report = await deps.list()
      const result = selectExactTitles(
        report === null ? [] : collectListedTests(report),
        selection.titles
      )
      if (result.missing.length > 0) {
        throw new MissingVideoTitlesError(result.missing)
      }
      if (result.unlistable.length > 0) {
        throw new Error(
          `Cannot select ${result.unlistable.map((title) => `"${title}"`).join(', ')} exactly: titles must not contain "›", line breaks, or leading or trailing spaces.`
        )
      }
      const path = await deps.writeTestList(`${result.lines.join('\n')}\n`)
      return ['--test-list', path]
    }
    default: {
      const exhaustive: never = selection
      throw new Error(`Unhandled selection: ${String(exhaustive)}`)
    }
  }
}
