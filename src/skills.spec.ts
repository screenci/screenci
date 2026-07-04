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

  it('tells playwright-cli inspection flows to look for cookie consent accept actions', () => {
    const skill = readPackageFile('skills/playwright-cli/SKILL.md')

    expect(skill).toContain(
      'check whether a cookie consent or\n  cookie policy banner appeared'
    )
    expect(skill).toContain('inside its initial\n  `hide()` block')
  })
})
