# Recording an app that needs a sign-in

The person signs in once, in a real browser on their machine. ScreenCI saves the session and every recording replays it, so the video starts signed in and contains no sign-in at all.

**Never script a sign-in, and never ask the person for a password, a one-time code, or a recovery code.**

The person may not be technical: tell them exactly what to click (sign in in the window that opened, then the card's button), and nothing else.

## The flow

```bash
npx screenci login https://app.example.com   # opens a browser, returns at once
# tell the person to sign in and click the card's button
npx screenci login --wait                    # blocks until they do
```

1. `npx screenci login [url]` (URL optional when `use.baseURL` is set) opens a window and returns immediately.
2. The person signs in their usual way; 2FA, SSO, passkeys and magic links all work. Nothing they type reaches ScreenCI.
3. Run `npx screenci login --wait`. **Do not end your turn instead of waiting**: the card's click tells you nothing, and the person is left with a stalled chat. If it says the sign-in is still going, run it again. If they tell you they are done another way, `npx screenci login --done` finishes it.
4. Write the video with **no sign-in steps**.

Also: `--status` (metadata only), `--cancel`, `--profile admin` (a second named session), and `npx screenci logout`.

## The saved session

It is a Playwright `storageState` at `screenci/.screenci/auth/<profile>.json`, owner-readable and gitignored.

- It never leaves the machine. ScreenCI stores no credential for the person's product.
- Never print, copy, commit, or paste it: whoever holds it is signed in as that person.
- `screenci.config.ts` picks it up; do not add `use.storageState` unless asked.
- Explore with the same session: `playwright-cli state-load screenci/.screenci/auth/default.json`.

## When something is wrong

- **Signed-out recording**: the session expired. Run `npx screenci login` again.
- **No display**: you are on a server; that is the CI case below.
- **Real account recorded**: say so; a demo or test account is almost always right.
- **Bot check** ("Just a moment...") with a valid session: set `channel: 'chrome'` in `use`.

## CI, and accounts with two-factor

Only when the person asks for CI, and always against a dedicated CI test account, never a real person's.

1. **Carry a saved session**: the person stores `screenci/.screenci/auth/default.json` in a repository secret (e.g. `APP_SESSION_STATE`) and the workflow writes it back to that path before recording. It expires and must be refreshed; say so.
2. **Sign in from a committed script** using repository secrets, writing `storageState` to `SCREENCI_APP_STORAGE_STATE`. If the account uses an authenticator app, derive the code from the `secret` of its `otpauth://` URI with a TOTP library such as [`otpauth`](https://www.npmjs.com/package/otpauth):

```ts
import { TOTP } from 'otpauth'

if (process.env.CI_APP_TOTP_SECRET) {
  const code = new TOTP({ secret: process.env.CI_APP_TOTP_SECRET }).generate()
  await page.getByLabel('Authentication code').fill(code)
}
```

The TOTP secret is as sensitive as the password. It belongs in a repository secret on a dedicated CI test account, never on a real person's account, and never write one into `screenci/.env` on a laptop: interactive `screenci login` needs no such thing.
