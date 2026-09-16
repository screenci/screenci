# Pull Request Previews

Every pull request can re-record the videos it might change and post the
result on the pull request itself: one check run and one comment with a
thumbnail and a watch link per video and language. A flow that no longer
works fails the check, like any other test. When the previews look right,
approve them in ScreenCI, and merging the pull request makes exactly those
versions the served ones at the public URLs. Nothing is published until then.

#### You will learn

- [how a pull request run differs from a push run](#what-a-pull-request-run-does)
- [what the pull request shows](#what-the-pull-request-shows)
- [how approval and merging publish](#approve-then-merge)
- [what to set up once](#set-up)
- [how to keep the cost down](#cost-and-scope)

## What a pull request run does

The generated GitHub Actions workflow records on two triggers:

| Trigger        | Command                                    | Result                                                            |
| -------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| push to `main` | `screenci preview`                         | the shared **CI preview** on the project page                     |
| `pull_request` | `screenci export --no-wait --pr "$PR_URL"` | rendered versions, grouped under the pull request, never selected |

`--pr <url>` takes the pull request's URL (the workflow passes
`github.event.pull_request.html_url`). The run records every video, uploads
the recordings, and exits without waiting for the renders. As each render
finishes, ScreenCI updates the pull request.

A pull request run never selects a version, so it cannot combine with
`--select`. The public URL keeps serving what it served before, whatever
happens on the pull request.

Every new push to the pull request starts a new run, which replaces the
previous previews: the comment is edited in place and a new check run is
created for the new commit.

## What the pull request shows

**The check run** ("ScreenCI previews") mirrors where the review stands:

| Check status    | Meaning                                                                   |
| --------------- | ------------------------------------------------------------------------- |
| in progress     | recording or rendering                                                    |
| failure         | a flow broke (Playwright failed) or a render failed                       |
| action required | every video rendered and the previews await approval in ScreenCI          |
| success         | approved                                                                  |
| neutral         | the pull request closed without merging, or a newer run replaced this one |

Because "awaiting approval" is `action required`, a team can make the check a
[required status check](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)
on the branch: a pull request that changes a video then cannot merge until
someone approved the new video.

**The comment** lists every video and language with a thumbnail, a watch
link, the render status, and the length compared with the version currently
served. The watch links are public share links to the rendered files (the same
kind `screenci export --share` creates); they are removed when the pull
request closes or a newer run replaces them, so a stale preview never lingers.

## Approve, then merge

Open the project page in the web app. The **Pull request previews** card lists
every open pull request with a preview, its state, and an **Approve** button
that becomes available once every render finished. Approval records who
approved and when, and flips the check run to success. **Revoke approval**
puts it back.

When GitHub reports the pull request merged:

- an **approved** preview publishes: each finished version becomes the
  selected version of its language, so the public URL and every embed serve
  what was reviewed. Exactly those versions, not "the latest render".
- a preview that was **not approved** does nothing. The served versions stay
  as they were; the push-to-`main` run records the merged code as usual.

A pull request closed without merging publishes nothing.

## Set up

Pull request previews need two things a plain CI recording does not:

1. **The workflow trigger.** New workspaces get it from `screenci init` or
   `screenci ci-workflow`. An existing workflow needs the `pull_request`
   trigger and the `--pr` branch of the record step; the shortest way is to
   rerun `screenci ci-workflow --force` from the repository root and review
   the diff. [CI setup](/docs/ci-setup#github-actions) shows the file.
2. **The ScreenCI GitHub App on the repository.** The check run and the
   comment are posted through the App (it needs the _Checks_ and _Pull
   requests_ write permissions). Connect it from the project page with
   **Set up recording trigger**; if the App was installed before pull request
   previews existed, GitHub asks you to accept the added permissions. Without
   the App the previews still appear on the project page, with a note that
   the pull request could not be updated.

The same `SCREENCI_SECRET` repository secret serves both triggers. Pull
requests opened from a fork do not receive repository secrets, so the
generated workflow skips them (the job's `if` condition) rather than failing;
a fork contribution gets its previews once a maintainer's branch carries it.

## Cost and scope

A pull request run exports, so it renders and bills like any other export
(previews on push stay free). Two ways to keep it proportionate:

- **Filter by path** in the workflow so pull requests that cannot change a
  video skip the run. The generated workflow carries a commented example:

  ```yaml
  on:
    pull_request:
      paths: ['src/**', 'screenci/**']
  ```

  Choose paths generously: a video also breaks when an API or a fixture
  changes. A run that was not needed costs a render; a run that was skipped
  and should not have been costs a stale video.

- **Filter by title** with `--grep` in the record step when only some videos
  should record on pull requests.

Deliberately, ScreenCI does not guess which videos a diff affects. The
promise is that a video which no longer matches the product fails the check,
and a guess would break that promise the first time it guessed wrong.

## What's next

- [Repository and CI](/docs/repository-and-ci) for the plain-language
  hand-off and what a failed run means.
- [Version history](/docs/guides/version-history) for how selected versions,
  public URLs, and retention work.
- [Public URLs and embeds](/docs/guides/public-urls-and-embeds) for what
  changes on the website when a preview publishes.
