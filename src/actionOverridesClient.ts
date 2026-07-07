/**
 * Backend client for web-editor action-parameter overrides, behind an injected
 * interface so the CLI can be tested with fakes and callers can degrade
 * gracefully when the backend does not (yet) serve the endpoint.
 *
 * The used parameter values (with explicit/default provenance and the actual
 * `used` values) reach the backend inside the uploaded `data.json`
 * (`RecordingData.actionParams`); this client only reads the editor's current
 * override state back.
 */
import type { ActionOverridesByVideo } from './actionParams.js'

export type ActionOverridesClient = {
  /**
   * Fetch the project's current editor overrides, keyed by video name then
   * `"<selector>|<method>|<occurrence>|<optionPath>"`. Returns an empty map
   * when the project has none or the endpoint is unavailable (404); throws on
   * other failures so callers can decide how loudly to degrade.
   */
  fetchActionOverrides(input: {
    apiUrl: string
    secret: string
    projectName: string
  }): Promise<ActionOverridesByVideo>
}

/**
 * The real client: `GET /cli/action-overrides?projectName=...` authenticated
 * with the project secret, response body `{ overrides }`. `fetchImpl` is
 * injected for tests.
 */
export function createActionOverridesClient(
  fetchImpl: typeof fetch = fetch
): ActionOverridesClient {
  return {
    async fetchActionOverrides({ apiUrl, secret, projectName }) {
      const params = new URLSearchParams({ projectName })
      const res = await fetchImpl(
        `${apiUrl}/cli/action-overrides?${params.toString()}`,
        { headers: { 'X-ScreenCI-Secret': secret } }
      )
      // A backend without the endpoint (not deployed yet) means no overrides.
      if (res.status === 404) return {}
      if (!res.ok) {
        throw new Error(`action-overrides fetch failed (${res.status})`)
      }
      const body = (await res.json()) as { overrides?: unknown }
      const overrides = body.overrides
      if (
        overrides === undefined ||
        overrides === null ||
        typeof overrides !== 'object' ||
        Array.isArray(overrides)
      ) {
        return {}
      }
      const result: ActionOverridesByVideo = {}
      for (const [videoName, perVideo] of Object.entries(overrides)) {
        if (
          typeof perVideo !== 'object' ||
          perVideo === null ||
          Array.isArray(perVideo)
        ) {
          continue
        }
        result[videoName] = { ...(perVideo as Record<string, unknown>) }
      }
      return result
    },
  }
}

/** Default client used by the CLI. */
export const defaultActionOverridesClient: ActionOverridesClient =
  createActionOverridesClient()

/** No-overrides client for tests and offline paths. */
export const stubActionOverridesClient: ActionOverridesClient = {
  fetchActionOverrides: async () => ({}),
}
