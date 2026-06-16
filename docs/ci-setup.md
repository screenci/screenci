# CI Setup

ScreenCI can generate a GitHub Actions workflow during `init`, and that workflow is meant to be a usable default, not a placeholder. It records the same way you do locally, but with repository secrets and a deterministic CI environment.

#### You will learn

- [what the generated workflow does](#generated-workflow)
- [which secret is required](#required-secret)
- [when to record on push and when to use manual dispatch](#push-vs-manual-dispatch)
- [how to keep CI recordings predictable](#keep-recordings-deterministic)

## Generated workflow

When you opt into CI during `init`, ScreenCI writes the workflow at the
repository root (GitHub only discovers workflows there):

```text
.github/workflows/screenci.yaml
```

Because your ScreenCI project lives in a self-contained `screenci/` directory,
every step in the workflow is scoped to it via `working-directory: screenci`
(and the dependency cache points at `screenci/<lockfile>`). If you ran `init`
from a nested package, the `working-directory` is the path from the repo root
to that `screenci/` folder.

If a `.github/workflows/screenci.yaml` already exists when you re-run `init`,
it is left untouched (ScreenCI logs that it skipped it rather than overwriting).

The generated workflow:

- runs on pushes to `main`
- also supports `workflow_dispatch`
- checks that `SCREENCI_SECRET` exists
- checks out the repository
- installs Node.js 24 and caches dependencies for your package manager
- installs dependencies and the Playwright Chromium Headless Shell inside `screenci/`
- runs `screenci record` inside `screenci/`

That is intentionally close to Playwright's own CI model. If you need deeper
background on Playwright runners and browser installation, see
[Playwright CI](https://playwright.dev/docs/ci).

The generated workflow caches package-manager dependencies through
`actions/setup-node`. It does not add a separate GitHub Actions browser cache
step.

ScreenCI itself requires Node.js 18 or newer. The generated recording workflow
uses Node.js 24 by default for a current CI runtime, while this repository's
package smoke tests separately verify the minimum supported Node.js 18 baseline.

## Required secret

Add `SCREENCI_SECRET` as a repository secret in GitHub Actions. You can get it
from [app.screenci.com/secrets](https://app.screenci.com/secrets).

The generated workflow fails early if the secret is missing so you do not spend time waiting for a recording job that cannot upload anything.

## Push vs manual dispatch

Start simple:

- keep `push` to `main` when you want docs and product videos to stay current automatically
- use `workflow_dispatch` when you want a manual review or approval step before recording

You can narrow the trigger later, but the generated default is intentionally easy to adopt.

## Keep recordings deterministic

CI recordings work best when:

- the target environment is stable
- feature flags are fixed
- seeded demo data is predictable
- authentication is handled before visible recording starts
- visible waits are tied to UI state instead of luck

If a flow only works when everything is timed perfectly, fix the script locally before pushing CI responsibility onto it.

## CI performance

ScreenCI records the browser in real time, so the speed of the CI machine directly affects the recording. On underpowered runners the same test that is instant locally can show visible pauses, because the browser is genuinely slow to respond.

Before each click-style interaction ScreenCI checks that the element is ready (visible, stable, enabled, receiving events). If that takes more than ~1 second it prints a warning so you can see where the time went:

```text
[screenci] Slow UI response: waited 2300ms for an element to become ready before an interaction. This is usually a slow CI machine, not screenci.
```

This is informational only. ScreenCI does not alter the recording to hide the wait. If recordings look sluggish:

- **Run one worker.** Parallel workers share the runner's CPU, and recording plus the browser are already heavy. The generated config already sets `workers: process.env.CI ? 1 : undefined` for this reason.
- **Use a faster runner.** Recording is CPU- and GPU-bound; GitHub's larger runners (or a faster provider) make a big difference. The free 2-core runners are the most likely to show pauses.
- **Keep the app fast.** Slow page loads, long hydration, and heavy on-page animation all delay when an element becomes interactive. Put setup inside `hide()` so that dead time stays out of the recording.
- **Keep CI on the `fast` encoder.** The capture encode itself can fall behind on a small runner, which drops frames and shortens recordings. The `fast` encoder is the default and the `init` config keeps CI on it while using the crisper `sharp` encoder locally. If you have overridden `encoder` globally, restore the conditional so CI stays light. See [Recording encoder](/docs/configuration#recording-encoder).

  ```ts
  use: {
    recordOptions: {
      // Lightest encode on constrained CI runners; full quality locally.
      encoder: process.env.CI ? 'fast' : 'sharp',
    },
  },
  ```

## Relation to accepted and latest renders

CI uses the same ScreenCI upload and render pipeline as local recording. The main difference is that it becomes repeatable and repository-driven, which is useful when published videos should follow the shipped app.

## Reading back render status in CI

Rendering happens after `screenci record` uploads, so a green `record` step does
not mean the videos are rendered yet. To check the renders from the run you just
made, use `screenci record-urls`. It reads the run id stored in
`.screenci/last-record.json` and prints each video's render status (`finished`,
`not_finished`, or `failed`) and public URLs as JSON, so a CI job can poll until
everything reaches `finished` or gate on failures. See
[`screenci record-urls`](/docs/reference/cli#screenci-record-urls) for the output
shape.

## What's next

- [Public URLs and Embeds](/docs/guides/public-urls-and-embeds) for delivery.
