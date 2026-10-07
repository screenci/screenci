import { describe, expect, it } from 'vitest'
import {
  agentCardCommonEdits,
  agentCardRules,
  formatAgentCard,
  formatInitBriefOutput,
} from './agentCard.js'

describe('formatAgentCard', () => {
  const card = formatAgentCard({ run: 'npx screenci', dir: 'screenci' })

  it('stays compact', () => {
    expect(card.split('\n').length).toBeLessThan(45)
  })

  it('carries a complete minimal script template', () => {
    expect(card).toContain("import { autoZoom, hide, video } from 'screenci'")
    expect(card).toContain('await hide(async () => { await page.goto(')
    expect(card).toContain('video.narration({ en: { intro:')
    expect(card).toContain('await autoZoom(')
  })

  it('tells the agent how to scroll and how to end the video', () => {
    expect(card).toContain(
      'scrollIntoViewIfNeeded({ centering: 1, duration: 1500 })'
    )
    expect(card).toContain('await page.waitForTimeout(1000)')
    expect(card).toContain('No browser of your own')
  })

  it('fills in the title and url when known', () => {
    const filled = formatAgentCard({
      run: 'pnpm screenci',
      dir: 'app/screenci',
      title: 'Create an invoice',
      url: 'https://app.example.com/invoices',
    })
    expect(filled).toContain('"Create an invoice",')
    expect(filled).toContain('page.goto("https://app.example.com/invoices")')
    expect(filled).toContain(
      'cd app/screenci && pnpm screenci preview "Create an invoice"'
    )
  })

  it('previews directly and ends with the link instruction', () => {
    expect(card).toContain('preview "<Video title>"')
    expect(card).toContain('`test <file>` only to debug a failure')
    expect(card.split('\n').at(-1)).toContain('link on the last line')
  })

  it('lists one-line rules and common edits in canonical form', () => {
    expect(agentCardRules().length).toBeGreaterThanOrEqual(6)
    expect(agentCardRules().length).toBeLessThanOrEqual(8)
    const edits = agentCardCommonEdits().join('\n')
    expect(edits).toContain('move: { duration: 400 }')
    expect(edits).toContain('speed(2, async () =>')
    expect(edits).toContain('overlays.md')
    expect(edits).toContain('screenshot(')
    for (const line of [...agentCardRules(), ...agentCardCommonEdits()]) {
      expect(line).not.toContain('\n')
    }
  })

  it('never uses em-dashes', () => {
    expect(card).not.toContain(String.fromCharCode(0x2014))
  })
})

describe('formatInitBriefOutput', () => {
  const base = {
    run: 'npx screenci',
    dir: 'screenci',
    secretsUrl: 'https://app.screenci.com/secrets',
  }

  it('prints the agent card and one secret line, without the terms notice', () => {
    const out = formatInitBriefOutput({ ...base, secretReady: false })
    expect(out).toContain('cd screenci && npx screenci preview')
    const last = out.split('\n').at(-1) ?? ''
    expect(last).toContain('previews need no SCREENCI_SECRET')
    // The trial terms notice prints when a preview records, not at init.
    expect(out).not.toContain('agrees to the terms')
    expect(out.split('\n').length).toBeLessThan(45)
  })

  it('says the secret is set when it is ready', () => {
    expect(formatInitBriefOutput({ ...base, secretReady: true })).toContain(
      'SCREENCI_SECRET is set'
    )
  })
})
