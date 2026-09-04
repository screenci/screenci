# CI Setup

This page is for videos whose scripts live in your repository. Every video is a
Playwright E2E test, so your own CI can re-record it on every release and fail
the build when the flow breaks. If your videos are made and edited from the web
app instead, you do not need any of this: see
[Create Videos from the Web App](/docs/guides/create-from-web-app), which also
covers moving a project's scripts into the repository when you want them
committed.

`init` can generate a ready-to-use [GitHub Actions](https://docs.github.com/en/actions)
workflow that records the same way you do locally, using a repository secret and a
deterministic CI environment.

#### You will learn

- [what the generated workflow does](#generated-workflow)
- [which secret is required](#required-secret)
- [how CI signs in to your app](#signing-in-from-ci)
- [how to keep CI recordings predictable](#keep-recordings-deterministic)
- [why asset files do not need to be committed](#asset-files-do-not-need-to-be-committed)

## Generated workflow

Opting into CI during `init` writes
[`.github/workflows/screenci.yaml`](https://docs.github.com/en/actions/using-workflows/about-workflows)
at the repository root (the only place GitHub discovers workflows). Every step is
scoped to your `screenci/` directory via `working-directory`. An existing file is
left untouched on re-run.

The workflow runs on pushes to `main` and on
[`workflow_dispatch`](https://docs.github.com/en/actions/using-workflows/manually-running-a-workflow),
installs Node.js 24 with dependency caching, installs the Playwright Chromium
Headless Shell, and runs `screenci preview`. It mirrors
[Playwright CI](https://playwright.dev/docs/ci). Use `push` to keep previews
current automatically, or `workflow_dispatch` for a manual, targeted run.

`preview` re-records every requested video and updates the live previews.

Prefer final rendered videos instead of live previews? The generated workflow
contains a commented-out alternative that swaps the record step for
`screenci export --no-wait`. `export` re-records and starts the final renders;
`--no-wait` exits right after the upload instead of waiting for rendering to
finish and downloading the results, which keeps the CI job short (the finished
renders are available in the ScreenCI app). Export minutes are spent on every
video that renders in the run.

## Required secret

Add [`SCREENCI_SECRET`](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)
as a repository secret, from
[app.screenci.com/secrets](https://app.screenci.com/secrets). The workflow fails
early if it is missing.

## Signing in from CI

Locally you sign in once in a browser and every recording replays that session
([Signing In](/docs/guides/signing-in)). CI has nobody to open a browser for,
so it has to be handed a session instead.

**Use a dedicated CI test account.** Never a real person's, and never one with
access to real customer data: the videos show whatever that account sees, and
its credentials end up in your repository's secrets.

### Option 1: carry a saved session

Copy the contents of `screenci/.screenci/auth/default.json` into a repository
secret (`APP_SESSION_STATE` below) and write it back to a file before the
record step:

```yaml
- name: Restore the app session
  working-directory: screenci
  run: |
    mkdir -p .screenci/auth
    printf '%s' "$APP_SESSION_STATE" > .screenci/auth/default.json
  env:
    APP_SESSION_STATE: ${{ secrets.APP_SESSION_STATE }}
```

Nothing else changes: the config picks that file up the same way it does
locally. The catch is that the session expires like any other, so someone has
to run `npx screenci login` and refresh the secret when it does.

### Option 2: sign in from a script in the repository

A small Playwright script signs the CI test account in before the record step
and saves the session where `SCREENCI_APP_STORAGE_STATE` points. It keeps
working without anyone tending to it.

```ts
// screenci/auth/sign-in.ts
import { chromium } from '@playwright/test'

const statePath = process.env.SCREENCI_APP_STORAGE_STATE!
const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()

await page.goto(`${process.env.APP_URL}/login`)
await page.getByLabel('Email').fill(process.env.CI_APP_USERNAME!)
await page.getByLabel('Password').fill(process.env.CI_APP_PASSWORD!)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL('**/dashboard')

await context.storageState({ path: statePath })
await browser.close()
```

```yaml
- name: Sign in to the app
  working-directory: screenci
  run: npx tsx auth/sign-in.ts
  env:
    APP_URL: https://staging.example.com
    CI_APP_USERNAME: ${{ secrets.CI_APP_USERNAME }}
    CI_APP_PASSWORD: ${{ secrets.CI_APP_PASSWORD }}
    SCREENCI_APP_STORAGE_STATE: .screenci/auth/default.json
```

Set `SCREENCI_APP_STORAGE_STATE` on the record step too, so it replays the
session the script just wrote.

### When the CI account has two-factor

An authenticator app does not need a phone in CI. When you enrol the account,
the QR code encodes an `otpauth://` URI whose `secret` parameter is the shared
key; any TOTP library turns that key plus the current time into the same
six-digit code the app expects.
[`otpauth`](https://www.npmjs.com/package/otpauth) is one such library. Save
the key as a repository secret and add a step to the script:

```ts
import { TOTP } from 'otpauth'

if (process.env.CI_APP_TOTP_SECRET) {
  const code = new TOTP({ secret: process.env.CI_APP_TOTP_SECRET }).generate()
  await page.getByLabel('Authentication code').fill(code)
  await page.getByRole('button', { name: 'Verify' }).click()
}
```

Treat that key as seriously as the password: it produces valid codes forever,
and it is enough on its own to defeat the second factor. It belongs in a
repository secret on a dedicated CI test account, and nowhere else. Never put
one on a real person's account, and never add one to a laptop's
`screenci/.env`: `screenci login` needs nothing of the sort, because a person
types the code themselves once.

## Recording your own app

If your videos navigate to a locally-running app via `webServer` in
`screenci.config.ts`, the generated workflow needs two extra steps so the app
is built and reachable when the record step runs.

### Update `screenci.config.ts`

In CI, use a static serve command (`npm run preview` for Vite, or your
framework's equivalent) instead of the dev server. The dev server's dependencies
live in the root `node_modules`, which the generated workflow does not install
by default. A built bundle also records more deterministically than a
hot-reloading dev server.

```ts
webServer: {
  command: process.env.CI ? 'npm run preview' : 'npm run dev',
  cwd: '..', // path from screenci/ to the project root
  url: process.env.CI ? 'http://localhost:4173' : 'http://localhost:5173',
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
},
use: {
  baseURL: process.env.CI ? 'http://localhost:4173' : 'http://localhost:5173',
},
```

The port split (`4173` for `vite preview`, `5173` for `vite dev`) is the Vite
default. Adjust both values to match your framework's preview and dev ports.

### Update the generated workflow

Add install and build steps for the root app before the screenci install step,
and extend `cache-dependency-path` to include the root lockfile:

```yaml
- uses: actions/setup-node@v6
  with:
    node-version: 24
    cache: npm
    cache-dependency-path: |
      package-lock.json
      screenci/package-lock.json

- name: Install app dependencies
  run: npm ci

- name: Build app
  run: npm run build

- name: Install dependencies
  working-directory: screenci
  run: npm ci
```

The `cache-dependency-path` list tells `actions/setup-node` to include the root
lockfile in its cache key, so restoring the cache reflects both dependency trees.

## Keep recordings deterministic

ScreenCI records the browser in real time, so the recording reflects the CI
machine's speed. Recordings are most reliable when the environment is stable,
feature flags and seeded data are fixed, authentication happens before visible
recording, and visible waits are tied to UI state. Fix flaky timing in the script
locally before pushing it to CI.

For faster, smoother recordings:

- **Run one worker.** The generated config sets `workers: process.env.CI ? 1 : undefined`.
- **Use a faster runner.** Recording is CPU- and GPU-bound; the free 2-core
  runners show the most pauses. See
  [larger runners](https://docs.github.com/en/actions/using-github-hosted-runners/about-larger-runners).
- **Keep setup in `hide()`** so load and hydration time stays out of the recording.
- **Keep CI on the `fast` encoder** (the `init` default). See
  [Recording encoder](/docs/configuration#recording-encoder).

  ```ts
  video.recordOptions({
    // Lightest encode on constrained CI runners; full quality locally.
    encoder: process.env.CI ? 'fast' : 'sharp',
  })('My video', async ({ page }) => {
    /* ... */
  })
  ```

## Asset files do not need to be committed

Overlay images and videos and narration media (the files you
reference with `video.overlays(...)` and narration `media`
cues) are uploaded to ScreenCI the first time you record with the files present. On
later runs they are reused: ScreenCI matches each asset to the version uploaded
for the same video (by file path, or by overlay name) and reuses it.

That means you do not have to commit these (often large) media files to the
repository. The `screenci init` scaffold gitignores the `recordings/assets/`
folder for exactly this reason. A typical flow:

1. Record locally once with the asset files present. The recording uploads them.
2. Keep the files out of git (or delete them). The committed `.screenci.ts`
   scripts still reference them by path.
3. On CI, the files are absent. Recording does not fail: each missing asset is
   logged (for example `Locally missing overlay, reusing the previously uploaded
version`) and reused from the previous upload.

If a referenced file is missing locally **and** no previously uploaded version
exists for that video (for example a brand new overlay that has never been
recorded with its file present), the upload fails with a clear message telling
you to record once with the file present, or to commit it. This keeps a video
from silently rendering without an overlay or narration clip.

Notes:

- The match is per video and per project. Record a video at least once with each
  asset present so a version exists to reuse.
- Overlays are matched by their declared name, so renaming an overlay (or its
  file) means the next record needs the file present again.
- Custom voice sample files (the clip you clone a voice from) follow the same
  rule: record once with the sample present so it uploads, and later runs reuse
  the cloned voice from that upload even when the file is absent locally.
- Overlays that use a [shared branding asset](./branding.md#shared-assets)
  (`{ branding: '<name>' }`) never need a local file at all: nothing is
  uploaded for them, and the export resolves the name against the Branding
  page. The name is checked before the upload, so a typo fails right away.
- This is independent of `.screenci/`, which is always gitignored and holds the
  local recording output.

## Reading back render status

When CI runs the `export` alternative,
`screenci export` waits for renders and exits `0` only when every
requested video rendered and downloaded, so a green export step means the
videos are done. When the videos are consumed from the web instead of as
files, `screenci export --no-wait` skips the wait and the download; the step
then only verifies that recording and uploading succeeded. To read the
results back later (or from another job), run
[`screenci info`](/docs/reference/cli#screenci-info): it reports each
language's render status (`finished`, `rendering`, or `failed`) and public
URLs as JSON.

## What's next

- [Screen Audio](/docs/guides/screen-audio) for capturing system audio in CI with a virtual audio device.
- [Public URLs and Embeds](/docs/guides/public-urls-and-embeds) for delivery.
