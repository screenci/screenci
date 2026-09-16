import { describe, expect, it } from 'vitest'
import { personRules, videoTitleGrep } from './start'

describe('start brief person rules', () => {
  it('tells the agent the person may be a teammate who does not code and how to report', () => {
    const text = personRules('npx screenci').join('\n')
    expect(text).toContain('teammate who does not code')
    expect(text).toContain('Report in plain language')
    expect(text).toContain('Never ask for a password')
    expect(text).toContain('on its own last line')
    expect(text).toContain('`npx screenci login` is the only sign-in path')
    expect(personRules('screenci-dev').join('\n')).toContain(
      '`screenci-dev login`'
    )
    expect(text).toContain(
      'only the codes that ask for a pipeline run complete on one'
    )
    expect(text).not.toContain('\u2014')
  })

  it('renders each rule as one bullet-ready sentence', () => {
    for (const rule of personRules('npx screenci')) {
      expect(rule.trim()).toBe(rule)
      expect(rule).not.toContain('\n')
    }
  })

  it('anchors and escapes a video title for the pipeline grep', () => {
    expect(videoTitleGrep('Update billing')).toMatch(/^\^.*\$$/)
    expect(videoTitleGrep('A (b)')).toContain('\\(b\\)')
  })
})
