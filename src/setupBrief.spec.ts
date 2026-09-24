import { describe, expect, it } from 'vitest'
import { authoringRules, personRules, videoTitleGrep } from './setup'

describe('setup brief person rules', () => {
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
    expect(text).toContain('Do not submit such a form there')
    expect(text).toContain('end the step on the completed form')
    expect(text).not.toContain(
      'whether it is OK to do it on the production site'
    )
    expect(text).toContain('dev, staging, or test deployment')
    expect(text).not.toContain('\u2014')
  })

  it('renders each rule as one bullet-ready sentence', () => {
    for (const rule of personRules('npx screenci')) {
      expect(rule.trim()).toBe(rule)
      expect(rule).not.toContain('\n')
    }
  })

  it('tells the agent how overlays must be built', () => {
    const text = authoringRules().join('\n')
    expect(text).toContain('never hand-write SVG or invent colours')
    expect(text).toContain('one shared theme file')
    expect(text).toContain('recordings/assets/')
    expect(text).toContain('video.narration({...})')
    expect(text).toContain('Narrate as the company that makes the product')
    expect(text).toContain('in the third person')
    expect(text).toContain('Use plausible mock data')
    expect(text).toContain('never call it mock, sample, test, or fictitious')
    expect(text).toContain('never mention that a form is not submitted')
    for (const rule of authoringRules()) {
      expect(rule.trim()).toBe(rule)
      expect(rule).not.toContain('\n')
      expect(rule).not.toContain('\u2014')
    }
  })

  it('anchors and escapes a video title for the pipeline grep', () => {
    expect(videoTitleGrep('Update billing')).toMatch(/^\^.*\$$/)
    expect(videoTitleGrep('A (b)')).toContain('\\(b\\)')
  })
})
