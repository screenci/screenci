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

## Relation to accepted and latest renders

CI uses the same ScreenCI upload and render pipeline as local recording. The main difference is that it becomes repeatable and repository-driven, which is useful when published videos should follow the shipped app.

## What's next

- [Public URLs and Embeds](/docs/guides/public-urls-and-embeds) for delivery.
