# CI Setup

ScreenCI can generate a GitHub Actions workflow during `init`, and that workflow is meant to be a usable default, not a placeholder. It records the same way you do locally, but with repository secrets and a deterministic CI environment.

#### You will learn

- [what the generated workflow does](#generated-workflow)
- [which secret is required](#required-secret)
- [when to record on push and when to use manual dispatch](#push-vs-manual-dispatch)
- [how to keep CI recordings predictable](#keep-recordings-deterministic)

## Generated workflow

When you opt into CI during `init`, ScreenCI writes:

```text
.github/workflows/screenci.yaml
```

The generated workflow:

- runs on pushes to `main`
- also supports `workflow_dispatch`
- checks that `SCREENCI_SECRET` exists
- checks out the repository
- installs Node.js 24 and caches npm dependencies
- installs Chromium if the Playwright cache is cold
- runs `npx screenci record`

That is intentionally close to Playwright's own CI model. If you need deeper
background on Playwright runners and browser installation, see
[Playwright CI](https://playwright.dev/docs/ci).

## Required secret

Add `SCREENCI_SECRET` as a repository secret in GitHub Actions.

The generated workflow fails early if the secret is missing so you do not spend time waiting for a recording job that cannot upload anything.

## Push vs manual dispatch

Start simple:

- keep `push` to `main` when you want docs and product videos to stay current automatically
- use `workflow_dispatch` when you want a manual review or approval step before recording

You can narrow the trigger later, but the generated default is intentionally easy to adopt.

## Keep recordings deterministic

<!-- screenci-doc-video:docs/ci-setup -->

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

- [Record and Publish](/docs/record-and-publish) for the local-to-remote flow.
- [Public URLs and Embeds](/docs/guides/public-urls-and-embeds) for delivery.
