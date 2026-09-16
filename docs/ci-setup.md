# CI Setup

Every video is a Playwright E2E test, so your own CI can re-record it on every
push and fail the build when the flow breaks. Any CI provider works: the
pipeline only needs Node.js, the `screenci/` workspace of your repository, and
one secret.

The quickest way in is **Add to CI** on the project page of the web app. It
gives you a prompt for your coding agent; the agent stores the secret in your
CI provider, adds a pipeline (generated for GitHub Actions, from the templates
below for the others), pushes, and triggers the first run. The project page
then shows that recording as the **CI preview**. This page is the reference
behind that prompt, and the manual path when you prefer to wire CI yourself.
For the plain-language walkthrough of the hand-off (Add to repository, Add to
CI, what a failed run means), see
[Repository and CI](/docs/repository-and-ci).

#### You will learn

- [what the pipeline does](#what-the-pipeline-does)
- [GitHub Actions](#github-actions), the generated workflow
- [other providers](#other-providers): GitLab CI, CircleCI, Buildkite, or a shell script
- [which secret is required](#required-secret)
- [how CI signs in to your app](#signing-in-from-ci)
- [how to keep CI recordings predictable](#keep-recordings-deterministic)
- [why asset files do not need to be committed](#asset-files-do-not-need-to-be-committed)
- [how to trigger recordings remotely](#trigger-recordings-remotely)

## What the pipeline does

Every pipeline, whatever the provider, does the same five things from the
repository root:

1. Checks out the repository.
2. Installs Node.js 24 (or the version your repository pins).
3. Installs the workspace dependencies with a frozen lockfile inside
   `screenci/`, then `npx playwright install --only-shell chromium` there.
4. Builds and starts your app when the videos navigate to it (see
   [Recording your own app](#recording-your-own-app)).
5. Runs `npx screenci preview` inside `screenci/` with `SCREENCI_SECRET` in
   the environment.

`preview` re-records every requested video and updates the live previews.
Previews recorded in CI land in the project's shared **CI preview**, kept
apart from the previews each team member records on their own machine. The
CLI detects CI from the usual environment variables (`CI`, `GITHUB_ACTIONS`,
`GITLAB_CI`, `BUILDKITE`, `CIRCLECI`); set `SCREENCI_CI=1` or `SCREENCI_CI=0`
to override. Uploads made with a CI key or an org-wide API key always count
as CI, since the key belongs to no one in particular; uploads made with the
personal credential `screenci start` sets up on a machine count as that
person's, unless they run in CI.

Prefer final rendered videos instead of live previews? Swap the record step
for `npx screenci export --no-wait --select`. `export` re-records and starts
the final renders; `--no-wait` exits right after the upload instead of waiting
for rendering to finish and downloading the results, which keeps the CI job
short (the finished renders are available in the ScreenCI app); `--select`
makes each finished render the served version of its language, so public URLs
follow the CI export (without it, an export never changes what is served).
Export minutes are spent on every video that renders in the run.

## GitHub Actions

Run this from the repository root:

```bash
npx screenci ci-workflow
```

It writes
[`.github/workflows/screenci.yaml`](https://docs.github.com/en/actions/using-workflows/about-workflows)
at the repository root (the only place GitHub discovers workflows), keyed to
the package manager your `screenci/` workspace uses. Every step is scoped to
the workspace via `working-directory`. An existing file is never overwritten
(pass `--force` to replace it). `screenci init --github-workflow` writes the
same file while scaffolding; plain `init` adds no CI.

The workflow runs on pushes to `main`, on every pull request, and on
[`workflow_dispatch`](https://docs.github.com/en/actions/using-workflows/manually-running-a-workflow)
with an optional `grep` input to record only matching titles. It installs
Node.js 24 with dependency caching, installs the Playwright Chromium Headless
Shell, and runs `screenci preview` on a push or dispatch and
`screenci export --no-wait --pr "$SCREENCI_PR_URL"` on a pull request, which
posts the rendered previews on the pull request for approval (see
[Pull request previews](/docs/pr-previews)). It mirrors
[Playwright CI](https://playwright.dev/docs/ci). The `export --select`
alternative for the push path is included as a comment, as is a `paths`
filter for the pull request trigger.

Store the secret with the GitHub CLI, reading it from the workspace env file
so it never lands in your shell history or a commit:

```bash
gh secret set SCREENCI_SECRET --body "$(grep '^SCREENCI_SECRET=' screenci/.env | cut -d= -f2-)"
```

Or paste it under Settings > Secrets and variables > Actions > Repository
secrets.

## Other providers

Keep the [five steps](#what-the-pipeline-does) and your repository's own
conventions (runner image, caching, branch filters). `SCREENCI_SECRET` comes
from the provider's secret store; never write it into the pipeline file.

### GitLab CI

Add the variable under Settings > CI/CD > Variables (masked), or with
`glab variable set SCREENCI_SECRET --masked --value "$(grep '^SCREENCI_SECRET=' screenci/.env | cut -d= -f2-)"`.

```yaml
# .gitlab-ci.yml
screenci:
  image: node:24
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
    - when: manual
  cache:
    key: screenci-$CI_COMMIT_REF_SLUG
    paths: [screenci/node_modules]
  script:
    - cd screenci
    - npm ci
    - npx playwright install --only-shell chromium
    - npx screenci preview
```

### CircleCI

Add `SCREENCI_SECRET` under Project Settings > Environment Variables (or a
context the job uses).

```yaml
# .circleci/config.yml
version: 2.1
jobs:
  screenci:
    docker:
      - image: cimg/node:24.0
    steps:
      - checkout
      - run:
          name: Install workspace
          working_directory: screenci
          command: npm ci && npx playwright install --only-shell chromium
      - run:
          name: Record previews
          working_directory: screenci
          command: npx screenci preview
workflows:
  record:
    jobs:
      - screenci:
          filters:
            branches:
              only: main
```

### Buildkite

Put `SCREENCI_SECRET` in the pipeline environment or the secrets plugin your
organisation uses.

```yaml
# .buildkite/pipeline.yml
steps:
  - label: ':video_camera: ScreenCI'
    if: build.branch == "main"
    commands:
      - cd screenci
      - npm ci
      - npx playwright install --only-shell chromium
      - npx screenci preview
```

### Anything else

Bitbucket Pipelines, Jenkins, Azure Pipelines, a cron job on a VM: run this
script with `SCREENCI_SECRET` exported and Node.js 24 installed, and it is
CI.

```bash
#!/usr/bin/env bash
set -euo pipefail
cd screenci
npm ci
npx playwright install --only-shell chromium
npx screenci preview
```

Replace `npm ci` with `pnpm install --frozen-lockfile` or
`yarn install --frozen-lockfile` when the workspace uses that manager, and
`npx` with `pnpm exec` or `yarn` accordingly.

## Required secret

The pipeline needs `SCREENCI_SECRET` in its environment. **Add to CI** mints a
CI key for the project (listed as "CI: <project>" at
[app.screenci.com/secrets](https://app.screenci.com/secrets)) and writes it to
`screenci/.env` for the agent to store; wiring CI by hand, copy any key from
that page. Uploads made with a CI key show as "CI" in the app. The generated
GitHub workflow fails early if the secret is missing.

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
`screenci.config.ts`, the pipeline needs two extra steps so the app is built
and reachable when the record step runs.

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

### Update the pipeline

For GitHub Actions, add install and build steps for the root app before the
screenci install step, and extend `cache-dependency-path` to include the root
lockfile (the generated workflow carries these as commented hints). Other
providers: add the same two commands before the workspace install.

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
files, `screenci export --no-wait --select` skips the wait and the download
and serves each render as it finishes; the step then only verifies that
recording and uploading succeeded. To read the
results back later (or from another job), run
[`screenci info`](/docs/reference/cli#screenci-info): it reports each
language's render status (`finished`, `rendering`, or `failed`) and public
URLs as JSON.

## Trigger recordings remotely

Besides the push trigger, the generated GitHub Actions workflow declares
`workflow_dispatch`, so a recording can be started without a terminal:

- **Record all** on the project page (and **Re-record** on a video) dispatch
  the workflow in one click once the repository is linked through the
  ScreenCI GitHub App (**Set up recording trigger** in the project's GitHub
  card). The run's status streams back to the project page.
- `screenci export --remote` dispatches the same workflow from any machine,
  for example from a release script.
- Without the GitHub App, the **Record all** prompt has the agent trigger the
  pipeline (`gh workflow run screenci.yaml`, a push to the recording branch,
  or the provider's run button).

See [Repository and CI](/docs/repository-and-ci#trigger-recordings-remotely)
for how the team uses this.

## What's next

- [Repository and CI](/docs/repository-and-ci) for the plain-language hand-off.
- [Pull request previews](/docs/pr-previews) for what a pull request run posts and how approval publishes.
- [Screen Audio](/docs/guides/screen-audio) for capturing system audio in CI with a virtual audio device.
- [Public URLs and Embeds](/docs/guides/public-urls-and-embeds) for delivery.
