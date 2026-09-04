# Recording an app that needs a sign-in

The person signs in once, in a real browser, on their own machine. ScreenCI
saves the resulting browser session and every recording replays it, so the
video starts already signed in and contains no sign-in at all.

**Never script a sign-in, and never ask the person for a password, a
one-time code, or a recovery code.** You do not need them, and asking for them
is the one thing this flow exists to avoid.

## The flow

```bash
npx screenci login https://app.example.com   # opens a browser, returns at once
# tell the person to sign in and click the card's button
npx screenci login --wait                    # blocks until they do
```

**Do not end your turn instead of waiting.** Clicking the card saves the
session in the browser but tells you nothing. If you are not waiting, the
person clicks, nothing replies, and they are stuck looking at a stalled chat.
That is the one way this flow goes wrong.

1. `npx screenci login [url]`. The URL is optional when `use.baseURL` is set in
   `screenci.config.ts`. It opens a browser window and **returns immediately**,
   so you are never blocked.
2. Tell the person to sign in in that window the way they always do. Two-factor
   codes, single sign-on, passkeys, and magic links all work, because it is a
   real browser and they are driving it. Nothing they type reaches ScreenCI.
3. Run `npx screenci login --wait`. It blocks until they finish and then
   reports the session. If it comes back saying the sign-in is still going,
   check whether they need help and run it again. If they tell you they are
   done some other way, `npx screenci login --done` finishes it immediately.
   The card only shows on the product's own pages, never over a single sign-on
   page, and it can be dragged if it is in the way.
4. Write the video with **no sign-in steps**: no credentials, no login form, no
   `hide()` block that types a password.

Other subcommands:

| Command                              | What it does                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `npx screenci login --wait`          | Block until the person finishes. Bounded, so run it again if it says the sign-in is still going. |
| `npx screenci login --status`        | Whether a session is saved, for which site, and whether it expired. Prints metadata only.        |
| `npx screenci login --cancel`        | Closes a browser you opened, saving nothing.                                                     |
| `npx screenci login --profile admin` | A second, named session, for a video that needs another role.                                    |
| `npx screenci logout`                | Forgets the saved session on this machine.                                                       |

## Where it lives, and what never happens to it

The session is a Playwright `storageState` at
`screenci/.screenci/auth/<profile>.json`, owner-readable only and gitignored.

- It never leaves the machine. ScreenCI stores no credential and no session for
  the person's own product.
- Never print it, copy it into a message, commit it, or paste it anywhere. It
  is a bearer credential: whoever holds it is signed in as that person.
- `screenci.config.ts` picks it up on its own. Do not add `use.storageState`
  unless the person asks for a specific file.

## When something is wrong

- **The recording shows a signed-out app.** The session expired. Run
  `npx screenci login`, ask the person to sign in again, then
  `npx screenci login --done`.
- **`login` says the machine has no display.** You are on a server or in a
  container. That is the CI case below, not this one.
- **The person recorded their real account.** Say so. The video shows whatever
  that account sees, so a demo or test account is almost always the right one.
- **The recording stops at a bot check** ("Just a moment...", "Performing
  security verification") even though the session is saved and the site loads
  fine in a normal browser. This is not the session: the recorder runs
  Chromium's headless shell, and its user agent is what the protection rejects.
  Set a normal desktop `userAgent` in `use` in `screenci.config.ts`. See the
  troubleshooting bullet in the main skill.

## Exploring the app before you write the video

`playwright-cli` has its own browser, signed out by default. Load the same
session into it so what you explore matches what will be recorded:

```bash
playwright-cli open
playwright-cli state-load screenci/.screenci/auth/default.json
playwright-cli goto https://app.example.com
```

Do this rather than writing a Playwright script of your own. A hand-rolled
script starts signed out, so you end up reading the signed-out marketing page
and writing selectors that do not exist once the recording signs in.

## CI, and accounts with two-factor

Only relevant when the `screenci/` workspace lives in the repository and CI
records the videos. CI has nobody to sign in, so it needs one of these. Set
them up only when the person asks for CI, and always against a **dedicated
test account**, never a real person's.

### Option 1: carry a saved session

Simplest. The person copies the contents of
`screenci/.screenci/auth/default.json` into a repository secret (for example
`APP_SESSION_STATE`), and the workflow writes it back to a file:

```yaml
- name: Restore the app session
  run: |
    mkdir -p screenci/.screenci/auth
    printf '%s' "$APP_SESSION_STATE" > screenci/.screenci/auth/default.json
  env:
    APP_SESSION_STATE: ${{ secrets.APP_SESSION_STATE }}
```

It expires like any session, so it has to be refreshed. Say that out loud when
you set it up.

### Option 2: sign in from a committed script

A script in the repository signs the CI test account in before the recording
step and saves the session. Credentials come from repository secrets, under
names the person picks, and the script writes `storageState` to the path
`SCREENCI_APP_STORAGE_STATE` points at.

If that CI account has an authenticator app enabled, the six-digit code can be
derived in the script instead of read off a phone: the enrolment QR code
encodes an `otpauth://` URI whose `secret` parameter is the shared key, and any
TOTP library turns that key plus the current time into the same code the app
expects. [`otpauth`](https://www.npmjs.com/package/otpauth) is one such
library.

```ts
import { chromium } from '@playwright/test'
import { TOTP } from 'otpauth'

const page = await (await (await chromium.launch()).newContext()).newPage()
await page.goto(`${process.env.APP_URL}/login`)
await page.getByLabel('Email').fill(process.env.CI_APP_USERNAME!)
await page.getByLabel('Password').fill(process.env.CI_APP_PASSWORD!)
await page.getByRole('button', { name: 'Sign in' }).click()

// Only when the CI test account has an authenticator app enabled.
if (process.env.CI_APP_TOTP_SECRET) {
  const code = new TOTP({ secret: process.env.CI_APP_TOTP_SECRET }).generate()
  await page.getByLabel('Authentication code').fill(code)
  await page.getByRole('button', { name: 'Verify' }).click()
}

await page.waitForURL('**/dashboard')
await page
  .context()
  .storageState({ path: process.env.SCREENCI_APP_STORAGE_STATE! })
```

Tell the person plainly: the TOTP secret is as sensitive as the password, since
it produces valid codes forever. It belongs in a repository secret, on a
dedicated CI test account, and nowhere else. Never put one on a real person's
account, and never write one into `screenci/.env` on a laptop: interactive
`screenci login` needs no such thing.
