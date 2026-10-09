import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '..')

function readPackageFile(relativePath: string) {
  return readFileSync(resolve(packageRoot, relativePath), 'utf8')
}

describe('skill guidance', () => {
  it('tells ScreenCI authors to accept cookie consent during hidden initial navigation', () => {
    const skill = readPackageFile('skills/screenci/SKILL.md')

    expect(skill).toContain(
      'find and click any cookie consent accept button inside that hidden block'
    )
  })

  it('routes a pasted setup code through screenci setup, not init', () => {
    const skill = readPackageFile('skills/screenci/SKILL.md')

    expect(skill).toContain('npx screenci@latest setup SC-XXXX-XXXX')
    expect(skill).toContain('--name "<project name>"')
    expect(skill).not.toContain('</content>')
  })

  it('sends authors to the overlays reference, the kit first, and forbids hand-drawn SVG', () => {
    const skill = readPackageFile('skills/screenci/SKILL.md')

    expect(skill).toContain('references/overlays.md')
    expect(skill).toContain("{ kit: 'callout', anchor, text }")
    expect(skill).toContain('never hand-write SVG or pick colours yourself')
    expect(skill).toContain('recordings/shared/theme.ts')
  })

  it('teaches the overlay kit first, then themed HTML/React placed with anchor', () => {
    const reference = readPackageFile('skills/screenci/references/overlays.md')

    expect(reference).toContain('## Use the built-in kit first')
    for (const kit of [
      'ring',
      'callout',
      'step',
      'spotlight',
      'badge',
      'keys',
      'title',
    ]) {
      expect(reference).toContain(`kit: '${kit}'`)
    }
    expect(reference).toContain('HTML/CSS or React, never hand-drawn SVG')
    expect(reference).toContain('recordings/shared/theme.ts')
    expect(reference).toContain("import { theme } from './theme'")
    expect(reference).toContain('anchor: p.target')
    expect(reference).toContain('overlayRect(')
    expect(reference).toContain('only that box is captured')
    // A page overlay has no base URL, so the reference must not teach a link.
    expect(reference).not.toContain('<link')
    // The examples practise what they preach: no SVG in any code block (the
    // prose names the tags only to forbid them).
    const codeBlocks = reference.match(/```[\s\S]*?```/g) ?? []
    expect(codeBlocks.length).toBeGreaterThan(3)
    for (const block of codeBlocks) {
      expect(block).not.toMatch(/<svg[\s>]/)
      expect(block).not.toContain('<path')
    }
  })

  it('sends authors to the login reference instead of scripting a sign-in', () => {
    const skill = readPackageFile('skills/screenci/SKILL.md')

    expect(skill).toContain('references/login.md')
    expect(skill).toContain('never ask the person for a password or a code')
    // The credentials ScreenCI used to hand out are gone.
    expect(skill).not.toContain('APP_USERNAME')
    expect(skill).not.toContain('APP_PASSWORD')
    expect(skill).not.toContain('pull-login')
  })

  it('spells out the sign-in flow, its secrecy rules, and the CI fallbacks', () => {
    const reference = readPackageFile('skills/screenci/references/login.md')

    expect(reference).toContain('npx screenci login')
    expect(reference).toContain('npx screenci login --done')
    expect(reference).toContain('Never script a sign-in')
    expect(reference).toContain('never leaves the machine')
    // CI is the only place a TOTP secret belongs, and only on a test account.
    expect(reference).toContain('otpauth')
    expect(reference).toContain('dedicated CI test account')
    expect(reference).toContain('never write one into `screenci/.env`')
  })

  it('keeps authors off hand-rolled explore scripts and off bot-check rabbit holes', () => {
    const skill = readPackageFile('skills/screenci/SKILL.md')

    // An agent that writes its own Playwright script explores a signed-out
    // app and finds selectors the recording will never see.
    expect(skill).toContain('never a Playwright script of your own')
    expect(skill).toContain(
      'playwright-cli state-load screenci/.screenci/auth/default.json'
    )
    // A challenge page is an environment problem with a one-line fix; without
    // this an agent rewrites the video code and probes launch options instead.
    // It sits in Routing, before any script is written.
    const routing = skill.slice(0, skill.indexOf('## Quick Start'))
    expect(routing).toContain('The recorder and the exploration browser differ')
    expect(routing).toContain("channel: 'chrome'")
    expect(routing).toContain('not the selector')
  })

  it('keeps pronounce tags out of narration and does not submit real-world forms on production', () => {
    const skill = readPackageFile('skills/screenci/SKILL.md')

    // Agents copied the old "always guide pronunciation" rule into every
    // brand name and domain; the voices get those right on their own.
    const narration = readPackageFile('skills/screenci/references/narration.md')
    expect(skill).not.toContain('Always guide pronunciation')
    expect(narration).not.toContain('Always guide pronunciation')
    expect(narration).toContain(
      'Do not add `[pronounce: ...]` tags on your own'
    )
    // An order or a payment on the production site is filled in, not sent.
    expect(skill).toContain('records against the live production site')
    expect(skill).toContain('Do not submit such a form there')
    expect(skill).toContain('Do not submit real-world forms on production')
    expect(skill).toContain('never mentions that the form is not submitted')
    expect(skill).toContain('dev, staging, or test deployment')
  })

  it('makes videos from the company perspective with mock data presented as real', () => {
    const skill = readPackageFile('skills/screenci/SKILL.md')

    const narration = readPackageFile('skills/screenci/references/narration.md')

    expect(skill).toContain('Company voice')
    expect(skill).toContain('references/narration.md')
    expect(narration).toContain('Speak as the company that makes the product')
    expect(narration).toContain(
      'Never describe the company or its product in the third person'
    )
    expect(skill).toContain('Mock data only, presented as real')
    expect(skill).toContain(
      'never says the data is mock, sample, or fictitious'
    )
  })

  it('tells playwright-cli to explore with the saved session, not a fresh sign-in', () => {
    const skill = readPackageFile('skills/playwright-cli/SKILL.md')

    expect(skill).toContain(
      'playwright-cli state-load screenci/.screenci/auth/default.json'
    )
    expect(skill).toContain(
      "Never type the person's credentials into this browser"
    )
  })

  it('tells playwright-cli inspection flows to look for cookie consent accept actions', () => {
    const skill = readPackageFile('skills/playwright-cli/SKILL.md')

    expect(skill).toContain(
      'check whether a cookie consent or\n  cookie policy banner appeared'
    )
    expect(skill).toContain('inside its initial\n  `hide()` block')
  })
  it('tells authors to report in plain language and finish with the video link', () => {
    const skill = readPackageFile('skills/screenci/SKILL.md')
    const login = readPackageFile('skills/screenci/references/login.md')
    const exportRef = readPackageFile('skills/screenci/references/export.md')

    expect(skill).toContain('## Reporting back to the person')
    expect(skill).toContain('teammate who does not code')
    expect(skill).toContain('Report in plain language')
    expect(skill).toContain('on its own last line')
    expect(skill).toContain(
      'only the codes that ask for a pipeline run complete on one'
    )
    expect(login).toContain('The person may not be technical')
    expect(exportRef).toContain('The person may not be technical')
    for (const text of [skill, login, exportRef]) {
      expect(text).not.toContain('\u2014')
    }
  })

  it('documents cursor timing with the nested move option, not flat moveDuration', () => {
    const zoom = readPackageFile(
      'skills/screenci/references/zoom-and-timing.md'
    )
    const doc = readPackageFile('docs/animated-interactions.md')

    expect(zoom).toContain('move: { duration: 1200')
    expect(zoom).toContain('move: { speed: 500 }')
    expect(doc).toContain('move: { speed: 500 }')
    for (const text of [doc]) {
      expect(text).not.toMatch(/\bmoveDuration:/)
      expect(text).not.toMatch(/\bmoveSpeed:/)
    }
  })

  it('routes every common edit to a reference file that exists', () => {
    const skill = readPackageFile('skills/screenci/SKILL.md')
    const links = [...skill.matchAll(/\]\((references\/[a-z-]+\.md)\)/g)].map(
      (m) => m[1]!
    )
    expect(links.length).toBeGreaterThan(5)
    for (const link of new Set(links)) {
      expect(() => readPackageFile(`skills/screenci/${link}`)).not.toThrow()
    }
  })

  describe('size budgets (agents pay for every byte they load)', () => {
    const byteLength = (path: string) =>
      Buffer.byteLength(readPackageFile(path), 'utf8')

    it('keeps the screenci SKILL.md under 6000 bytes', () => {
      expect(byteLength('skills/screenci/SKILL.md')).toBeLessThan(6000)
    })

    it('keeps the playwright-cli SKILL.md under 5000 bytes', () => {
      expect(byteLength('skills/playwright-cli/SKILL.md')).toBeLessThan(5000)
    })

    it('keeps each screenci reference under 5000 bytes', () => {
      const dir = resolve(packageRoot, 'skills/screenci/references')
      const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
      expect(files.length).toBeGreaterThan(5)
      for (const file of files) {
        expect(
          byteLength(`skills/screenci/references/${file}`),
          file
        ).toBeLessThan(5000)
      }
    })

    it('keeps every skill file free of em-dashes', () => {
      const dir = resolve(packageRoot, 'skills/screenci/references')
      const paths = [
        'skills/screenci/SKILL.md',
        'skills/playwright-cli/SKILL.md',
        ...readdirSync(dir).map((f) => `skills/screenci/references/${f}`),
      ]
      for (const path of paths) {
        expect(readPackageFile(path), path).not.toContain('\u2014')
      }
    })
  })
})
