import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfiguredEnvFilePath } from './cli'

// `resolveConfiguredEnvFilePath` must resolve `envFile` by EVALUATING the config
// module (the way Playwright evaluates a config value), not by scraping the
// source text. A dynamic `envFile: cond ? '.env.local' : '.env'` only has a real
// value once the module runs, so scraping would miss it and silently fall back
// to `.env`, loading prod values during a local recording.
describe('resolveConfiguredEnvFilePath', () => {
  let dir: string
  const originalEnvironment = process.env.SCREENCI_ENVIRONMENT

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'screenci-envfile-'))
  })

  afterEach(async () => {
    if (originalEnvironment === undefined) {
      delete process.env.SCREENCI_ENVIRONMENT
    } else {
      process.env.SCREENCI_ENVIRONMENT = originalEnvironment
    }
    await rm(dir, { recursive: true, force: true })
  })

  async function writeConfig(source: string): Promise<string> {
    const configPath = join(dir, 'screenci.config.mjs')
    await writeFile(configPath, source)
    return configPath
  }

  it('evaluates a dynamic envFile ternary and picks the local file', async () => {
    const configPath = await writeConfig(
      `export default {\n` +
        `  projectName: 'Test',\n` +
        `  envFile: process.env.SCREENCI_ENVIRONMENT === 'local' ? '.env.local' : '.env',\n` +
        `}\n`
    )

    process.env.SCREENCI_ENVIRONMENT = 'local'
    expect(await resolveConfiguredEnvFilePath(configPath)).toBe(
      join(dir, '.env.local')
    )
  })

  it('evaluates the same ternary to the prod file when not local', async () => {
    const configPath = await writeConfig(
      `export default {\n` +
        `  projectName: 'Test',\n` +
        `  envFile: process.env.SCREENCI_ENVIRONMENT === 'local' ? '.env.local' : '.env',\n` +
        `}\n`
    )

    delete process.env.SCREENCI_ENVIRONMENT
    expect(await resolveConfiguredEnvFilePath(configPath)).toBe(
      join(dir, '.env')
    )
  })

  it('resolves a plain string-literal envFile relative to the config', async () => {
    const configPath = await writeConfig(
      `export default { projectName: 'Test', envFile: '.env.custom' }\n`
    )

    expect(await resolveConfiguredEnvFilePath(configPath)).toBe(
      join(dir, '.env.custom')
    )
  })

  it('returns undefined when the config declares no envFile', async () => {
    const configPath = await writeConfig(
      `export default { projectName: 'Test' }\n`
    )

    expect(await resolveConfiguredEnvFilePath(configPath)).toBeUndefined()
  })
})
