import { describe, expect, it } from 'vitest'
import {
  buildSiteMetadata,
  classifySiteOrigin,
  parseLaunchedByEnv,
  toSiteOrigin,
} from './siteOrigin.js'

describe('toSiteOrigin', () => {
  it('keeps scheme, host and port and drops path, query and hash', () => {
    expect(toSiteOrigin('https://app.example.com/login?token=abc#x')).toBe(
      'https://app.example.com'
    )
    expect(toSiteOrigin('http://localhost:3000/dashboard')).toBe(
      'http://localhost:3000'
    )
  })

  it('returns null for non-http URLs and garbage', () => {
    expect(toSiteOrigin('about:blank')).toBeNull()
    expect(toSiteOrigin('data:text/html,<p>hi</p>')).toBeNull()
    expect(toSiteOrigin('file:///tmp/index.html')).toBeNull()
    expect(toSiteOrigin('not a url')).toBeNull()
    expect(toSiteOrigin(undefined)).toBeNull()
    expect(toSiteOrigin('')).toBeNull()
  })
})

describe('classifySiteOrigin', () => {
  it.each([
    'http://localhost:3000',
    'http://app.localhost:5173',
    'http://127.0.0.1:8080',
    'http://127.5.5.5',
    'http://0.0.0.0:3000',
    'http://[::1]:3000',
    'http://10.0.0.4:3000',
    'http://192.168.1.20',
    'http://172.16.0.1',
    'http://172.31.255.255',
    'http://169.254.10.1',
    'http://mymac.local:3000',
  ])('%s is local', (origin) => {
    expect(classifySiteOrigin(origin)).toBe('local')
  })

  it.each([
    'https://app.example.com',
    'https://staging.example.com:8443',
    'http://172.32.0.1',
    'http://172.15.0.1',
    'http://8.8.8.8',
    'https://localhost.example.com',
  ])('%s is deployed', (origin) => {
    expect(classifySiteOrigin(origin)).toBe('deployed')
  })

  it('treats an unparsable origin as deployed', () => {
    expect(classifySiteOrigin('nope')).toBe('deployed')
  })
})

describe('parseLaunchedByEnv', () => {
  it('accepts the three known values only', () => {
    expect(parseLaunchedByEnv('agent')).toBe('agent')
    expect(parseLaunchedByEnv('existing')).toBe('existing')
    expect(parseLaunchedByEnv('config')).toBe('config')
    expect(parseLaunchedByEnv('yes')).toBeUndefined()
    expect(parseLaunchedByEnv(undefined)).toBeUndefined()
  })
})

describe('buildSiteMetadata', () => {
  it('prefers the navigated origin over baseURL', () => {
    expect(
      buildSiteMetadata({
        navigatedOrigin: 'http://localhost:3000',
        baseURL: 'https://app.example.com',
        webServerConfigured: false,
        env: {},
      })
    ).toEqual({ origin: 'http://localhost:3000', kind: 'local' })
  })

  it('falls back to baseURL and omits launchedBy when nothing is known', () => {
    expect(
      buildSiteMetadata({
        navigatedOrigin: null,
        baseURL: 'https://app.example.com/some/path',
        webServerConfigured: false,
        env: {},
      })
    ).toEqual({ origin: 'https://app.example.com', kind: 'deployed' })
  })

  it('returns undefined without any origin', () => {
    expect(
      buildSiteMetadata({
        navigatedOrigin: null,
        baseURL: undefined,
        webServerConfigured: true,
        env: { SCREENCI_APP_LAUNCHED_BY: 'agent' },
      })
    ).toBeUndefined()
  })

  it('reads the agent declaration from the environment', () => {
    expect(
      buildSiteMetadata({
        navigatedOrigin: 'http://localhost:3000',
        baseURL: undefined,
        webServerConfigured: false,
        env: { SCREENCI_APP_LAUNCHED_BY: 'agent' },
      })
    ).toEqual({
      origin: 'http://localhost:3000',
      kind: 'local',
      launchedBy: 'agent',
    })
  })

  it('lets a configured webServer win over the env declaration', () => {
    expect(
      buildSiteMetadata({
        navigatedOrigin: 'http://localhost:3000',
        baseURL: undefined,
        webServerConfigured: true,
        env: { SCREENCI_APP_LAUNCHED_BY: 'agent' },
      })
    ).toEqual({
      origin: 'http://localhost:3000',
      kind: 'local',
      launchedBy: 'config',
    })
  })
})
