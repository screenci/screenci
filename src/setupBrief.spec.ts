import { describe, expect, it } from 'vitest'
import {
  authoringRules,
  personRules,
  videoTitleGrep,
  whatToDoLine,
} from './setup'

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
    expect(text).toContain('do not submit forms that act on the real world')
    expect(text).toContain('end on the completed form')
    expect(text).not.toContain(
      'whether it is OK to do it on the production site'
    )
    expect(text).toContain('dev, staging, or test deployment')
    expect(text).not.toContain('\u2014')
  })

  it('keeps the delivery-path rule only for the kinds that may run on a pipeline', () => {
    const delivery = 'only the codes that ask for a pipeline run'
    expect(personRules('npx screenci', 'record').join('\n')).toContain(delivery)
    expect(personRules('npx screenci', 'ci').join('\n')).toContain(delivery)
    expect(personRules('npx screenci', 'project').join('\n')).not.toContain(
      delivery
    )
  })

  it('renders each rule as one bullet-ready sentence', () => {
    for (const rule of personRules('npx screenci')) {
      expect(rule.trim()).toBe(rule)
      expect(rule).not.toContain('\n')
    }
  })

  it('states the browser mismatch and the fast loop before any script is written', () => {
    const text = authoringRules().join('\n')
    expect(text).toContain("set channel: 'chrome'")
    expect(text).toContain('not the selector')
    expect(text).toContain('do not open the uploaded video')
    expect(text).toContain('`npx screenci explore <url>`')
    expect(text).not.toContain('Google')
  })

  it('repeats the short card rules: narration voice, mock data, no extras', () => {
    const text = authoringRules().join('\n')
    expect(text).toContain(
      'No overlays, zoom, or timing overrides unless asked'
    )
    expect(text).toContain('Open by stating the purpose')
    expect(text).toContain('as the company: "we"/"our"')
    expect(text).toContain('Use plausible mock data presented as real')
    expect(text).toContain('never submit real-world forms')
    expect(authoringRules().length).toBeLessThanOrEqual(10)
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

describe('whatToDoLine', () => {
  it('repeats the task the person typed', () => {
    expect(
      whatToDoLine({ kind: 'edit', task: { description: ' Skip the login ' } })
    ).toBe('Skip the login')
  })

  it('tells the agent to ask when a one-click edit carries no description', () => {
    expect(whatToDoLine({ kind: 'edit', task: { description: '' } })).toContain(
      'Ask them one question, what should change'
    )
    // Other kinds fill their own default description server side.
    expect(whatToDoLine({ kind: 'record', task: { description: '' } })).toBe('')
  })
})
