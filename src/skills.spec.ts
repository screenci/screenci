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
    const recordReference = readPackageFile('skills/screenci/references/record.md')

    expect(skill).toContain(
      'explicitly try to find and click any cookie consent or cookie policy accept button there if one appears'
    )
    expect(recordReference).toContain(
      'explicitly try to find and click any cookie consent or cookie policy accept button if one appears'
    )
  })

  it('tells playwright-cli inspection flows to look for cookie consent accept actions', () => {
    const skill = readPackageFile('skills/playwright-cli/SKILL.md')

    expect(skill).toContain(
      'explicitly check whether a cookie consent or cookie policy banner appeared'
    )
    expect(skill).toContain('inside the initial `hide()` block')
  })
})
