import { describe, expect, it } from 'vitest'
import { createProjectFormatter, type PrettierModule } from './format.js'

const FILE = '/proj/recordings/demo.screenci.ts'

function fakePrettier(overrides: Partial<PrettierModule> = {}): PrettierModule {
  return {
    resolveConfigFile: async () => '/proj/.prettierrc',
    resolveConfig: async () => ({ semi: false }),
    format: async (source, options) =>
      `/* ${JSON.stringify(options)} */\n${source}`,
    ...overrides,
  }
}

describe('createProjectFormatter', () => {
  it('formats with the resolved config and the file path as parser hint', async () => {
    const format = createProjectFormatter('/proj', {
      loadPrettier: () => fakePrettier(),
    })
    const result = await format(FILE, 'const a=1')
    expect(result).toBe(`/* {"semi":false,"filepath":"${FILE}"} */\nconst a=1`)
  })

  it('returns the content unchanged when prettier does not resolve', async () => {
    const format = createProjectFormatter('/proj', {
      loadPrettier: () => null,
    })
    expect(await format(FILE, 'const a=1')).toBe('const a=1')
  })

  it('returns the content unchanged when no config file is found', async () => {
    const format = createProjectFormatter('/proj', {
      loadPrettier: () => fakePrettier({ resolveConfigFile: async () => null }),
    })
    expect(await format(FILE, 'const a=1')).toBe('const a=1')
  })

  it('formats with defaults when the config file resolves to empty', async () => {
    const format = createProjectFormatter('/proj', {
      loadPrettier: () => fakePrettier({ resolveConfig: async () => null }),
    })
    expect(await format(FILE, 'const a=1')).toBe(
      `/* {"filepath":"${FILE}"} */\nconst a=1`
    )
  })

  it('passes through and warns when formatting throws', async () => {
    const warnings: string[] = []
    const format = createProjectFormatter('/proj', {
      loadPrettier: () =>
        fakePrettier({
          format: async () => {
            throw new Error('unterminated string')
          },
        }),
      warn: (message) => warnings.push(message),
    })
    expect(await format(FILE, 'const a=1')).toBe('const a=1')
    expect(warnings).toEqual([
      `Skipped formatting ${FILE}: unterminated string`,
    ])
  })

  it('loads prettier once and caches the result across files', async () => {
    let loads = 0
    const format = createProjectFormatter('/proj', {
      loadPrettier: () => {
        loads += 1
        return fakePrettier()
      },
    })
    await format(FILE, 'a')
    await format('/proj/recordings/other.screenci.ts', 'b')
    expect(loads).toBe(1)
  })
})
