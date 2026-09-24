import { describe, expect, it } from 'vitest'
import {
  configuredRecordingUrl,
  configuredUrlIsLocal,
  resolveRecordingTarget,
  type RecordingTargetInput,
} from './recordingTarget.js'

const LIVE = 'https://app.example.com'
const DEV = 'http://localhost:3000'

function input(
  overrides: Partial<RecordingTargetInput> = {}
): RecordingTargetInput {
  return {
    configBaseUrl: undefined,
    configWebServerUrl: undefined,
    taskAppUrl: undefined,
    contextSiteUrl: null,
    versionSite: undefined,
    repoAtHand: false,
    configuredReachable: null,
    ...overrides,
  }
}

describe('configuredRecordingUrl', () => {
  it('prefers the dev server the config starts over its base URL', () => {
    expect(
      configuredRecordingUrl({ configBaseUrl: LIVE, configWebServerUrl: DEV })
    ).toBe(DEV)
    expect(
      configuredRecordingUrl({
        configBaseUrl: LIVE,
        configWebServerUrl: undefined,
      })
    ).toBe(LIVE)
  })

  it('classifies the configured address', () => {
    expect(
      configuredUrlIsLocal({
        configBaseUrl: DEV,
        configWebServerUrl: undefined,
      })
    ).toBe(true)
    expect(
      configuredUrlIsLocal({
        configBaseUrl: LIVE,
        configWebServerUrl: undefined,
      })
    ).toBe(false)
    expect(
      configuredUrlIsLocal({
        configBaseUrl: undefined,
        configWebServerUrl: undefined,
      })
    ).toBe(false)
  })
})

describe('resolveRecordingTarget', () => {
  it('records as configured when the config names a deployed site', () => {
    expect(resolveRecordingTarget(input({ configBaseUrl: LIVE }))).toEqual({
      mode: 'configured',
      url: LIVE,
    })
  })

  it('lets the dialog URL win over a deployed config address', () => {
    expect(
      resolveRecordingTarget(
        input({
          configBaseUrl: LIVE,
          taskAppUrl: 'https://staging.example.com',
        })
      )
    ).toEqual({ mode: 'configured', url: 'https://staging.example.com' })
  })

  it('falls back to the context site when the config names nothing', () => {
    expect(resolveRecordingTarget(input({ contextSiteUrl: LIVE }))).toEqual({
      mode: 'configured',
      url: LIVE,
    })
    expect(resolveRecordingTarget(input())).toEqual({
      mode: 'configured',
      url: null,
    })
  })

  it('overrides a local config with the deployed site the dialog named, even inside the repository', () => {
    expect(
      resolveRecordingTarget(
        input({
          configWebServerUrl: DEV,
          taskAppUrl: LIVE,
          repoAtHand: true,
          configuredReachable: true,
        })
      )
    ).toEqual({ mode: 'override', url: LIVE, configuredUrl: DEV })
  })

  it('keeps the dev server when it already answers', () => {
    expect(
      resolveRecordingTarget(
        input({
          configWebServerUrl: DEV,
          contextSiteUrl: LIVE,
          configuredReachable: true,
        })
      )
    ).toEqual({ mode: 'configured', url: DEV })
  })

  it('keeps the dev server inside the repository: the agent starts it', () => {
    expect(
      resolveRecordingTarget(
        input({
          configWebServerUrl: DEV,
          contextSiteUrl: LIVE,
          repoAtHand: true,
          configuredReachable: false,
        })
      )
    ).toEqual({ mode: 'configured', url: DEV })
  })

  it('swaps to the context site outside the repository', () => {
    expect(
      resolveRecordingTarget(
        input({
          configWebServerUrl: DEV,
          contextSiteUrl: LIVE,
          configuredReachable: false,
        })
      )
    ).toEqual({ mode: 'override', url: LIVE, configuredUrl: DEV })
  })

  it('swaps to the site the chosen version was recorded against when nothing else is known', () => {
    expect(
      resolveRecordingTarget(
        input({
          configBaseUrl: DEV,
          versionSite: { origin: LIVE, kind: 'deployed' },
          configuredReachable: false,
        })
      )
    ).toEqual({ mode: 'override', url: LIVE, configuredUrl: DEV })
  })

  it('ignores a version recorded against another local address', () => {
    expect(
      resolveRecordingTarget(
        input({
          configBaseUrl: DEV,
          versionSite: { origin: 'http://127.0.0.1:5173', kind: 'local' },
          configuredReachable: false,
        })
      )
    ).toEqual({ mode: 'stop', configuredUrl: DEV })
  })

  it('stops when the dev server is out of reach and no deployed address is known', () => {
    expect(
      resolveRecordingTarget(
        input({ configWebServerUrl: DEV, configuredReachable: false })
      )
    ).toEqual({ mode: 'stop', configuredUrl: DEV })
  })

  it('trusts the config when the check was skipped and nothing else is known', () => {
    expect(
      resolveRecordingTarget(
        input({ configWebServerUrl: DEV, configuredReachable: null })
      )
    ).toEqual({ mode: 'configured', url: DEV })
  })
})
