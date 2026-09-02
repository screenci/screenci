import { describe, expect, it } from 'vitest'
import { readIslandProjectId, stripIslandProjectId } from './configLite.js'

describe('stripIslandProjectId', () => {
  it('removes a projectId line and keeps the rest', () => {
    const source = `export default defineConfig({
  projectName: 'Acme',
  projectId: 'proj_1',
  envFile: '.env',
})
`
    const stripped = stripIslandProjectId(source)
    expect(stripped).toBe(`export default defineConfig({
  projectName: 'Acme',
  envFile: '.env',
})
`)
    expect(readIslandProjectId(stripped)).toBeUndefined()
  })

  it('removes an inline projectId', () => {
    const source =
      "export default { projectName: 'Acme', projectId: \"proj_1\", envFile: '.env' }"
    expect(stripIslandProjectId(source)).toBe(
      "export default { projectName: 'Acme', envFile: '.env' }"
    )
  })

  it('leaves a config without projectId alone', () => {
    const source = "export default { projectName: 'Acme' }"
    expect(stripIslandProjectId(source)).toBe(source)
  })
})
