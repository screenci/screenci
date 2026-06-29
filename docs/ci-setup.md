# CI Setup

`init` can generate a ready-to-use [GitHub Actions](https://docs.github.com/en/actions)
workflow that records the same way you do locally, using a repository secret and a
deterministic CI environment.

#### You will learn

- [what the generated workflow does](#generated-workflow)
- [which secret is required](#required-secret)
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
Headless Shell, and runs `screenci record`. It mirrors
[Playwright CI](https://playwright.dev/docs/ci). Use `push` to keep videos current
automatically, or `workflow_dispatch` for a manual approval step before recording.

## Required secret

Add [`SCREENCI_SECRET`](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)
as a repository secret, from
[app.screenci.com/secrets](https://app.screenci.com/secrets). The workflow fails
early if it is missing.

## Recording your own app

If your videos navigate to a locally-running app via `webServer` in
`screenci.config.ts`, the generated workflow needs two extra steps so the app
is built and reachable when `screenci record` runs.

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
  use: {
    recordOptions: {
      // Lightest encode on constrained CI runners; full quality locally.
      encoder: process.env.CI ? 'fast' : 'sharp',
    },
  },
  ```

## Asset files do not need to be committed

Overlay images and videos, background audio, and narration media (the files you
reference with `video.overlays(...)`, `video.audio(...)`, and narration `media`
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
from silently rendering without an overlay, audio track, or narration clip.

Notes:

- The match is per video and per project. Record a video at least once with each
  asset present so a version exists to reuse.
- Overlays are matched by their declared name, so renaming an overlay (or its
  file) means the next record needs the file present again.
- Custom voice sample files are the exception: they are read locally at record
  time to identify the voice, so keep those committed or present.
- This is independent of `.screenci/`, which is always gitignored and holds the
  local recording output.

## Trigger recordings remotely

Because the workflow accepts
[`workflow_dispatch`](https://docs.github.com/en/actions/using-workflows/manually-running-a-workflow),
you can start a recording run on demand without pushing a commit, from either the
app or the CLI.

To enable this, connect the GitHub App to your project once. ScreenCI uses a
[GitHub App](https://docs.github.com/en/apps/overview) rather than a personal
access token: **no long-lived credential is stored**. Access is granted by the
installation and revoked the moment you uninstall the App, and each trigger uses
a short-lived token scoped to only `Actions: write` on the repositories you pick.

1. Open the project page in [app.screenci.com](https://app.screenci.com).
2. In **GitHub recording workflow**, click **Connect GitHub** and install the App
   on the repository you want to record (you choose exactly which repos it can
   access).
3. Back on the project page, pick the **repository**, and (optionally) the
   workflow file (defaults to `screenci.yaml`) and git ref (defaults to `main`),
   then **Save**.

Once connected, you can dispatch the recording workflow two ways:

- **From the app:** click **Record all** on the project page. To record a single
  video or screenshot, use its **Record** button (on the project page or its
  detail page).
- **From the CLI:** run [`screenci record --remote`](/docs/reference/cli#-remote).
  It resolves the project from `SCREENCI_SECRET` and triggers the workflow without
  recording locally.

### Targeted recordings

You can record only some videos or screenshots instead of all of them, from
either surface:

- **From the app:** the per-item **Record** buttons.
- **From the CLI:** pass `--grep` to filter by title, just like local recording:

  ```bash
  screenci record --remote --grep "Onboarding"
  ```

Both forward the filter to the workflow's optional `grep` input, which
`screenci init` includes in the generated `screenci.yaml`. If your workflow
predates that input, add it (or re-run `screenci init`) so targeted runs work.

To revoke access, click **Disconnect** on the project page or uninstall the App
from your GitHub settings.

## Reading back render status

Rendering happens after `record` uploads, so a green `record` step does not mean
videos are rendered. Run [`screenci info`](/docs/reference/cli#screenci-info) to
read each language's render status (`finished`, `rendering`, or `failed`) and
public URLs as JSON. A CI job can poll until `finished` or gate on `failed`.

## What's next

- [Screen Audio](/docs/guides/screen-audio) for capturing system audio in CI with a virtual audio device.
- [Public URLs and Embeds](/docs/guides/public-urls-and-embeds) for delivery.
