/**
 * `screenci preview` startup record pass.
 *
 * A preview run always records: every managed video (the grep filter, or all
 * declared videos without one) is re-recorded as a preview (uploaded to the
 * preview slot, no render). There is no freshness check; asking for a preview
 * means fresh footage.
 */
import type { RecordingData } from './recordingData.js'
import type { DevListenLogger } from './devListen.js'

export type KeptRecording = {
  /** Recording directory name, for logging. */
  entry: string
  data: RecordingData
}

export type DevStartupDeps = {
  /** Reads every kept recording's data (data.json or last-data.json). */
  readKeptRecordings: () => Promise<KeptRecording[]>
  /**
   * Records the videos matching the grep pattern (or all when undefined) as
   * a preview (uploaded to the preview slot, no render) and uploads them.
   */
  recordPreview: (grepPattern: string | undefined) => Promise<void>
  /**
   * Reports the videos currently being recorded (the editor locks their
   * timelines). Called with the names before the record pass and with []
   * once it finishes. Best-effort.
   */
  setSyncing?: (videoNames: string[]) => Promise<void>
  /**
   * Formats the (color-highlighted) preview command scoped to one video, for
   * the record-all announcement's "preview just one" hint. Optional; the hint
   * is omitted when unwired or when no video name is known yet.
   */
  suggestPreviewCommand?: (videoName: string) => string
  logger: DevListenLogger
}

export type DevStartupOptions = {
  /**
   * Only record videos whose name matches this pattern (regex, like --grep).
   * Without a grep, every declared video records.
   */
  grep?: string
}

export type DevStartupResult = {
  /** Videos recorded during the pass (names known from kept recordings). */
  recorded: string[]
}

/** Matcher for `--grep`-style filters. */
export function grepMatcher(
  grep: string | undefined
): (name: string) => boolean {
  if (grep === undefined) return () => true
  try {
    const regex = new RegExp(grep)
    return (name) => regex.test(name)
  } catch {
    return (name) => name.includes(grep)
  }
}

export async function runDevStartupSync(
  options: DevStartupOptions,
  deps: DevStartupDeps
): Promise<DevStartupResult> {
  const matches = grepMatcher(options.grep)

  // The announcement names come from the kept recordings (base names, deduped
  // across per-language passes). A brand-new video has no kept recording yet;
  // the record pass still covers it via the grep.
  const names = [
    ...new Set(
      (await deps.readKeptRecordings())
        .map((kept) => kept.data.metadata?.videoName)
        .filter((name): name is string => name !== undefined && matches(name))
    ),
  ]

  if (options.grep === undefined) {
    const hint =
      deps.suggestPreviewCommand !== undefined && names[0] !== undefined
        ? ` Preview just one with ${deps.suggestPreviewCommand(names[0])}.`
        : ''
    deps.logger.info(`Recording all videos.${hint}`)
  } else if (names.length === 1) {
    deps.logger.info(`Recording: ${names[0]}`)
  } else if (names.length > 1) {
    deps.logger.info(`Recording ${names.length} videos: ${names.join(', ')}`)
  } else {
    deps.logger.info('Recording matched videos.')
  }

  if (deps.setSyncing) await deps.setSyncing(names).catch(() => {})
  try {
    await deps.recordPreview(options.grep)
  } finally {
    if (deps.setSyncing) await deps.setSyncing([]).catch(() => {})
  }

  return { recorded: names }
}
