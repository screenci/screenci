# CI Setup

`init` can generate a ready-to-use [GitHub Actions](https://docs.github.com/en/actions)
workflow that records the same way you do locally, using a repository secret and a
deterministic CI environment.

#### You will learn

- [what the generated workflow does](#generated-workflow)
- [which secret is required](#required-secret)
- [how to keep CI recordings predictable](#keep-recordings-deterministic)

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
- **From the CLI:** run [`screenci record --remote`](/docs/reference/cli#-remote),
  optionally with `--grep "<name>"` to record only matching items. It resolves the
  project from `SCREENCI_SECRET` and triggers the workflow without recording
  locally.

Targeted runs use the workflow's optional `grep` input, which `screenci init`
includes in the generated `screenci.yaml`.

To revoke access, click **Disconnect** on the project page or uninstall the App
from your GitHub settings.

## Reading back render status

Rendering happens after `record` uploads, so a green `record` step does not mean
videos are rendered. Run [`screenci info`](/docs/reference/cli#screenci-info) to
read each language's render status (`finished`, `rendering`, or `failed`) and
public URLs as JSON. A CI job can poll until `finished` or gate on `failed`.

## What's next

- [Public URLs and Embeds](/docs/guides/public-urls-and-embeds) for delivery.
