import { describe, expect, it } from 'vitest'
import { readIslandBaseUrl, readIslandWebServerUrl } from './configLite.js'

describe('readIslandBaseUrl', () => {
  it('reads use.baseURL in every quote style', () => {
    expect(
      readIslandBaseUrl(
        `export default defineConfig({ use: { baseURL: 'http://localhost:3000' } })`
      )
    ).toBe('http://localhost:3000')
    expect(
      readIslandBaseUrl(
        `defineConfig({\n  use: {\n    trace: "on",\n    baseURL: "https://app.example.com",\n  },\n})`
      )
    ).toBe('https://app.example.com')
    expect(
      readIslandBaseUrl(
        'defineConfig({ use: { baseURL: `https://x.example` } })'
      )
    ).toBe('https://x.example')
  })

  it('is undefined without a literal', () => {
    expect(readIslandBaseUrl('defineConfig({})')).toBeUndefined()
    expect(
      readIslandBaseUrl('defineConfig({ use: { baseURL: process.env.URL } })')
    ).toBeUndefined()
    // A baseURL outside the use block is not the config's.
    expect(
      readIslandBaseUrl(
        `const other = { baseURL: 'http://x' }\ndefineConfig({ use: { trace: 'on' } })`
      )
    ).toBeUndefined()
  })
})

describe('readIslandWebServerUrl', () => {
  it('reads webServer.url', () => {
    expect(
      readIslandWebServerUrl(
        `defineConfig({\n  webServer: {\n    command: 'pnpm dev',\n    url: 'http://localhost:5173',\n    reuseExistingServer: true,\n  },\n  use: { baseURL: 'http://localhost:5173' },\n})`
      )
    ).toBe('http://localhost:5173')
  })

  it('reads past nested objects and does not match a similar key', () => {
    expect(
      readIslandWebServerUrl(
        `defineConfig({ webServer: { command: 'pnpm dev', env: { PORT: '3000', URL: 'http://nested' }, url: 'http://localhost:3000' } })`
      )
    ).toBe('http://localhost:3000')
    expect(
      readIslandBaseUrl(
        `defineConfig({ use: { viewport: { width: 1 }, baseURL: 'http://localhost:5173' } })`
      )
    ).toBe('http://localhost:5173')
    expect(
      readIslandBaseUrl(`defineConfig({ reuse: { baseURL: 'http://wrong' } })`)
    ).toBeUndefined()
    expect(
      readIslandWebServerUrl(
        `defineConfig({ webServer: { env: { url: 'http://wrong' } } })`
      )
    ).toBeUndefined()
  })

  it('is undefined without a web server', () => {
    expect(
      readIslandWebServerUrl(`defineConfig({ use: { baseURL: 'http://x' } })`)
    ).toBeUndefined()
  })
})
