import { describe, expect, it } from 'vitest'
import {
  createCodegenFailureLog,
  formatCodegenFailureLine,
} from './codegenFailureLog.js'

const UNKNOWN_VIDEO_MESSAGE = (cue: string) =>
  `Edit for the "${cue}" narration (et) could not be applied to code: ` +
  `[unknown-video] locked narration cue '${cue}' on video 'Old Name': the ` +
  `builder declaration of video 'Old Name' was not found in exactly one source file`

describe('formatCodegenFailureLine', () => {
  it('turns an unknown-video refusal into one actionable line', () => {
    const line = formatCodegenFailureLine({
      videoName: 'Old Name',
      editDescription: 'the "intro" narration (et)',
      message: UNKNOWN_VIDEO_MESSAGE('intro'),
    })
    expect(line).toContain('Could not apply edits to "Old Name"')
    expect(line).toContain('renamed or removed in code')
    expect(line).not.toContain('locked narration cue')
  })

  it('keeps the raw message for other failures', () => {
    const line = formatCodegenFailureLine({
      videoName: 'Video',
      editDescription: 'the "intro" narration (et)',
      message: 'boom',
    })
    expect(line).toBe(
      'Codegen for the "intro" narration (et) (Video) failed: boom'
    )
  })
})

describe('createCodegenFailureLog', () => {
  function make() {
    const lines: string[] = []
    const flushes: (() => void)[] = []
    const log = createCodegenFailureLog((line) => lines.push(line), {
      schedule: (fn) => flushes.push(fn),
    })
    return { log, lines, flush: () => flushes.splice(0).forEach((fn) => fn()) }
  }

  it('collapses a burst of identical-cause failures into one line plus a count', () => {
    const { log, lines, flush } = make()
    for (const cue of ['intro', 'openSearch', 'typeQuery', 'pickResult']) {
      log.logFailure({
        videoName: 'Old Name',
        editDescription: `the "${cue}" narration (et)`,
        message: UNKNOWN_VIDEO_MESSAGE(cue),
      })
    }
    expect(lines).toHaveLength(1)
    flush()
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe(
      '(3 more edits for "Old Name" failed for the same reason.)'
    )
  })

  it('logs distinct causes and videos separately', () => {
    const { log, lines, flush } = make()
    log.logFailure({
      videoName: 'A',
      editDescription: 'the language set',
      message: UNKNOWN_VIDEO_MESSAGE('intro'),
    })
    log.logFailure({
      videoName: 'B',
      editDescription: 'the "intro" narration (et)',
      message: 'boom',
    })
    expect(lines).toHaveLength(2)
    flush()
    // No counts: each burst had a single failure.
    expect(lines).toHaveLength(2)
  })

  it('starts a fresh burst after the window flushed', () => {
    const { log, lines, flush } = make()
    const input = {
      videoName: 'A',
      editDescription: 'the "intro" narration (et)',
      message: UNKNOWN_VIDEO_MESSAGE('intro'),
    }
    log.logFailure(input)
    flush()
    log.logFailure(input)
    expect(lines).toHaveLength(2)
  })
})
