import {
  classifySiteOrigin,
  toSiteOrigin,
  type SiteKind,
} from './siteOrigin.js'

/**
 * Which address a recording made from this machine should run against.
 *
 * The scripts name an address (`webServer.url` or `use.baseURL` in
 * `screenci.config.ts`). When that is a dev server and this machine cannot
 * start it (no repository at hand, or the organisation does not let agents
 * start the app) the recording must go against the deployed site instead:
 * the person typed one in the dialog, the AI context names one, or the
 * version being edited was recorded against one. Pure, unit-tested; the
 * caller probes the configured address first.
 */

export type RecordingTargetInput = {
  /** `use.baseURL` of the island config, when it sets one. */
  configBaseUrl: string | undefined
  /** `webServer.url` of the island config, when it sets one. */
  configWebServerUrl: string | undefined
  /** The app URL typed in the dialog. */
  taskAppUrl: string | undefined
  /** The site URL from the AI context. */
  contextSiteUrl: string | null
  /** Where the version being edited was recorded, when known. */
  versionSite: { origin: string; kind: SiteKind } | undefined
  /** The product's repository is at hand (the command ran inside it). */
  repoAtHand: boolean
  /** The organisation lets the agent start the app from the repository. */
  runLocallyIfNeeded: boolean
  /** Whether the configured local address answered; null when not probed. */
  configuredReachable: boolean | null
}

export type RecordingTarget =
  /** Record as the config (or the task/context URL) says; null: nothing known. */
  | { mode: 'configured'; url: string | null }
  /** The config names a dev server this machine cannot run; use `url` instead. */
  | { mode: 'override'; url: string; configuredUrl: string }
  /** The config names a dev server this machine cannot run and no deployed address is known. */
  | { mode: 'stop'; configuredUrl: string }

function isDeployed(url: string | undefined | null): url is string {
  if (url === undefined || url === null) return false
  const origin = toSiteOrigin(url)
  return origin !== null && classifySiteOrigin(origin) === 'deployed'
}

/** The address the config records against: the dev server it starts, else its base URL. */
export function configuredRecordingUrl(input: {
  configBaseUrl: string | undefined
  configWebServerUrl: string | undefined
}): string | undefined {
  return input.configWebServerUrl ?? input.configBaseUrl
}

/** Whether the configured address is a local one that `setup` should probe before deciding. */
export function configuredUrlIsLocal(input: {
  configBaseUrl: string | undefined
  configWebServerUrl: string | undefined
}): boolean {
  const url = configuredRecordingUrl(input)
  if (url === undefined) return false
  const origin = toSiteOrigin(url)
  return origin !== null && classifySiteOrigin(origin) === 'local'
}

export function resolveRecordingTarget(
  input: RecordingTargetInput
): RecordingTarget {
  const configuredUrl = configuredRecordingUrl(input)
  const preferred = input.taskAppUrl ?? input.contextSiteUrl ?? null

  if (configuredUrl === undefined || !configuredUrlIsLocal(input)) {
    // Nothing local in the config: the dialog's URL wins, then the config's
    // deployed address, then the context (today's behaviour).
    return {
      mode: 'configured',
      url: input.taskAppUrl ?? configuredUrl ?? preferred,
    }
  }

  // The person typed a deployed address: they want the recording there.
  if (isDeployed(input.taskAppUrl)) {
    return { mode: 'override', url: input.taskAppUrl, configuredUrl }
  }
  // The dev server answers (someone started it): record against it.
  if (input.configuredReachable === true) {
    return { mode: 'configured', url: configuredUrl }
  }
  // It can be started from the repository: the brief tells the agent how.
  if (input.repoAtHand && input.runLocallyIfNeeded) {
    return { mode: 'configured', url: configuredUrl }
  }
  const fallback = [
    input.contextSiteUrl,
    input.versionSite?.kind === 'deployed' ? input.versionSite.origin : null,
  ].find(isDeployed)
  if (fallback !== undefined) {
    return { mode: 'override', url: fallback, configuredUrl }
  }
  // Not probed (--skip-site-check) and nothing else known: trust the config.
  if (input.configuredReachable === null) {
    return { mode: 'configured', url: configuredUrl }
  }
  return { mode: 'stop', configuredUrl }
}
