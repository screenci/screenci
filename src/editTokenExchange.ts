/**
 * Exchanges the org secret for a machine-scoped personal editor token, so a
 * project connects with a single credential paste: with SCREENCI_SECRET set,
 * the CLI mints (or re-fetches) its own SCREENCI_EDIT_TOKEN instead of asking
 * the user to create one on the Secrets page. The server keeps exchanged
 * tokens listed and revocable like hand-minted ones, and the exchange is
 * idempotent per (org, machine).
 */

export type ExchangeEditTokenOptions = {
  apiUrl: string
  secret: string
  machineName: string
  fetchFn?: typeof fetch
}

export type ExchangeEditTokenResult =
  { ok: true; editToken: string } | { ok: false; error: string }

export async function exchangeEditToken(
  options: ExchangeEditTokenOptions
): Promise<ExchangeEditTokenResult> {
  const fetchFn = options.fetchFn ?? fetch
  let response: Response
  try {
    response = await fetchFn(`${options.apiUrl}/cli/dev/exchange-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ScreenCI-Secret': options.secret,
      },
      body: JSON.stringify({ machineName: options.machineName }),
    })
  } catch (err) {
    return {
      ok: false,
      error: `Could not reach the ScreenCI backend: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON error bodies fall through to the status-based message below.
  }

  if (!response.ok) {
    const message =
      body !== null &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : `Token exchange failed with status ${response.status}`
    return { ok: false, error: message }
  }

  if (
    body === null ||
    typeof body !== 'object' ||
    !('editToken' in body) ||
    typeof body.editToken !== 'string' ||
    body.editToken.length === 0
  ) {
    return { ok: false, error: 'Token exchange returned an invalid response' }
  }

  return { ok: true, editToken: body.editToken }
}
