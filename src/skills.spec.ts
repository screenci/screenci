import { readFileSync } from 'node:fs'
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

  it('routes a pasted setup code through screenci start, not init', () => {
    const skill = readPackageFile('skills/screenci/SKILL.md')

    expect(skill).toContain('npx screenci@latest start SC-XXXX-XXXX')
    expect(skill).toContain('--name "<project name>"')
    expect(skill).not.toContain('</content>')
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
    expect(skill).toContain('The recording lands on a bot check')
    expect(skill).toContain('userAgent')
    expect(skill).toContain('not a selector problem')
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
})
