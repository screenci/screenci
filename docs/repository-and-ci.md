# Repository and CI

Every ScreenCI video is a Playwright E2E test. The scripts live wherever the
agent that wrote them ran; ScreenCI keeps a snapshot so the next prompt can
start from them on any machine. Engineering moves them where it wants them
by running a prompt inside the repository (the agent commits the scripts
next to the product's code), and **Add to CI** makes your pipeline record the
videos on every push. From then on a video that goes stale is a failed run,
and nobody on the team records anything by hand.

This is the plain-language page for the engineering hand-off. The reference
behind the generated pipeline, other providers, secrets, and deterministic
recordings is [CI Setup](/docs/ci-setup).

#### You will learn

- [why the videos belong in the repository](#why-the-video-is-a-test)
- [working from the repository](#working-from-the-repository)
- [Add to CI](#add-to-ci)
- [Record all and Re-record](#record-all-and-re-record)
- [triggering recordings remotely](#trigger-recordings-remotely)
- [what a failed run means](#when-a-run-fails)

## Why the video is a test

A `.screenci.ts` script drives the real app with Playwright: it clicks the
real buttons, fills the real forms, and records the screen. When the product
changes and the flow still works, re-running the script produces an
up-to-date video with no human involved. When the flow breaks (a renamed
button, a moved page), the script fails exactly like an E2E test, before a
customer watches an outdated walkthrough. That only pays off when the script
lives with the code and runs on every push, which is what the steps below
set up.

## Working from the repository

There is no separate step for getting the scripts into git. Run any prompt
(**Add video**, **Edit**, **Re-record**) inside the repository of the app:

1. `screenci setup <code>` uses the repository's `screenci/` workspace when
   it has one. When it has none, the command pulls the snapshot ScreenCI
   holds into `<repository>/screenci` (or scaffolds a new project there).
2. The agent does the task and records the preview from that workspace.
3. The agent commits `screenci/` on a branch and opens a pull request (or
   pushes to the default branch when the repository allows it). Review it
   like any other change.

Every `preview` and `export` uploads a snapshot of the workspace's text files
(config and scripts; never env files, lockfiles, or media), so the video page
shows the sources behind each version and a prompt run somewhere else can
start from them. A workspace already on the machine is never overwritten by
that snapshot; the local copy wins. A project whose scripts must not leave the
repository sets `uploadSources: false` in `screenci.config.ts`; its prompts
must then run inside the repository, where the agent finds the scripts.

## Add to CI

The button appears on the project and video pages until CI records the
project. It needs no description; an optional note under Advanced tells the
agent what it cannot see ("we use GitLab CI, the app needs a build step").

The agent:

1. Mints a CI key for the project (named `CI: <project>` on the
   [Secrets page](https://app.screenci.com/secrets); delete it there to cut CI off).
2. Stores it as `SCREENCI_SECRET` in your CI provider's secret store.
3. Adds a pipeline: `screenci ci-workflow` writes the GitHub Actions
   workflow, and the templates under
   [Other providers](/docs/ci-setup#other-providers) cover GitLab CI,
   CircleCI, Buildkite, and a plain shell script.
4. Commits on a branch, pushes, and triggers the first run. That run uploads
   its recordings as the project's **CI preview**, and the tab that made the
   prompt opens the first video.

A repository without a `screenci/` workspace yet gets the snapshot ScreenCI
holds pulled into it, committed together with the pipeline, so **Add to CI**
alone is enough. When the pipeline must sign in
to your app, see [Signing in from CI](/docs/ci-setup#signing-in-from-ci).

### What a pipeline run costs

Recording and live previews are free on every plan; only rendered exports
count against the plan's quota. The generated pipeline runs `screenci
preview`, so a push that re-records every video costs nothing, and the
previews are there to watch and edit in the browser. Switch the pipeline to
`screenci export --select` (see [CI Setup](/docs/ci-setup)) only when you
want each release to publish rendered videos automatically; then each
changed video renders once per release. Either way the cost follows the
videos you publish, not the number of runs.

## Record all and Re-record

**Record all** (project page) and **Re-record** (video page and every video
card) record again with the scripts as they are. They look the same for
everyone on the team, and do the right thing for the project:

- When the repository is linked through the ScreenCI GitHub App, one click
  dispatches the recording workflow and the page shows the run's progress.
- Otherwise the button produces a prompt. The agent triggers your pipeline
  when CI records the project, and records on its own machine when nothing
  does.

Either way the script is only touched where the product changed underneath
it; narration, overlays, and editor changes stay.

## Trigger recordings remotely

Three things start a recording without anyone opening a terminal:

- **A push.** The generated workflow runs on every push to the default
  branch, so shipping the feature re-records its videos.
- **The Record all button** with the GitHub App linked (project page,
  **Set up recording trigger** in the GitHub card). It dispatches the
  workflow with `workflow_dispatch` and streams the run status back to the
  project page.
- **The CLI from anywhere:** `screenci export --remote` dispatches the same
  workflow instead of recording locally, for example from a release script.

For providers without a dispatch API, a push to the recording branch or the
provider's own run button does the same. See
[GitHub Actions](/docs/ci-setup#github-actions) for the workflow file and its
`grep` input that limits a run to some videos.

## When a run fails

A failed recording run is the stale-video alarm. The run page in the web app
shows which video failed and the Playwright error. Fix it the way the team
prefers:

- **Edit** on the video page with one sentence ("the invite dialog moved to
  the members page; update the flow and keep the narration"). The agent
  changes the script, opens a pull request, and records a preview.
- Or fix the `.screenci.ts` file directly; it is a normal Playwright test in
  your repository. See [Video script basics](/docs/video-script-basics).

Merge, push, and the pipeline records the fixed video. The video's public
URL keeps serving the last selected version until you select the new one
(or the pipeline runs `export --select`), so a broken run never publishes a
broken video. See [Version history](/docs/guides/version-history).

## Before a run fails: pull requests

The generated workflow also records on every pull request and posts the
result on the pull request itself: a check run that fails when a flow broke,
and a comment with a thumbnail and a watch link per video. So the stale-video
alarm rings while the change is still under review, next to the code that
caused it. Someone on the team approves the previews in ScreenCI, and merging
serves exactly those versions. See
[Pull request previews](/docs/pr-previews).

## What's next

- [CI Setup](/docs/ci-setup) for the workflow file, other providers, secrets,
  and deterministic recordings.
- [Start in a repository](/docs/agent-integration) when you would rather
  begin from the code than from the web app.
- [Who does what](/docs/roles) for how the rest of the team uses the same
  videos.
