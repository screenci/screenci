/**
 * "Is the site up?" check for `screenci start`. Any HTTP response counts as
 * reachable (a login wall or a 500 still means something is listening); only
 * a connection failure or timeout is unreachable.
 */
export const SITE_PROBE_TIMEOUT_MS = 5000

export async function probeSite(
  url: string,
  fetchFn: typeof fetch,
  timeoutMs = SITE_PROBE_TIMEOUT_MS
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    })
    await response.body?.cancel().catch(() => undefined)
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
