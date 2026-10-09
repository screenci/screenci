# screenci ci

`screenci ci` is the command a CI pipeline runs. It records the videos that
are flagged for recording in the app, from the repository checkout, and
reports each result to a results page. It never downloads code from
ScreenCI: the only code that runs in your pipeline is the code in your
repository.

```bash
npx screenci ci
```

`screenci ci-workflow` and the [CI Setup](/docs/ci-setup) templates run it.
Pipelines written before it existed run `npx screenci preview`, which keeps
working and records every video.

#### You will learn

- [what a run does](#what-a-run-does)
- [which videos it records](#which-videos-it-records)
- [drift: edits made in the app](#drift-edits-made-in-the-app)
- [exit codes](#exit-codes)

## What a run does

1. Loads `screenci.config.ts` and the env file, and requires
   `SCREENCI_SECRET` (a missing secret fails the step at once).
2. Asks ScreenCI for the project's recording settings and the videos flagged
   for recording.
3. Compares the files ScreenCI holds for the flagged videos with the
   checkout and warns about differences (see [drift](#drift-edits-made-in-the-app)).
4. Registers the run and prints the results page URL, so you can follow it
   while it records.
5. Records exactly the flagged videos, with the same record pass
   `screenci preview` uses (Chromium is installed when missing; the uploads
   land in the project's CI preview, and the recorded videos' files are
   stored as described in [Project files](/docs/guides/project-files)).
6. Reports each video as finished or failed (with the error), prints the
   results URL again, and exits.

## Which videos it records

A video is flagged in the app, in its recording settings. `screenci ci`
records the flagged videos whose title a script in the checkout declares,
matching titles exactly: flagging "Intro" never records "Product Intro" or
"Intro v2". It lists the tests and runs exactly the matching ones (every
language pass of each), not a title pattern. A flagged video with no script
in the checkout is reported as failed ("No video titled ... in this
checkout").

- **Nothing flagged:** the command says so and exits `0` without recording.
- **Recording runs not enabled for the organisation** (or a ScreenCI
  deployment that does not track runs): it records every video, exactly like
  `screenci preview`.

## Drift: edits made in the app

Teammates can edit a video in the app. When the files ScreenCI holds for a
flagged video differ from the checkout, `screenci ci` lists them and carries
on recording the checkout's version:

```
The files ScreenCI holds for the flagged videos differ from this checkout (the checkout is what records):
  changed:        recordings/add-a-lead.screenci.ts
  only in app:    recordings/add-a-lead/callout.html
  only in repo:   recordings/shared/old-theme.ts
To bring edits made in the app into the repository, use the video's "Add to CI" hand-off in the app and commit what it pulls.
```

Drift never fails the run. To bring the app's edits into the repository,
use the video's **Add to CI** hand-off: the prompt runs `screenci setup` in
the repository, which pulls exactly the changed files, and the agent commits
them. The next pipeline run then records the edited version.

## Exit codes

- `0`: every flagged video recorded and uploaded (or nothing was flagged).
- `1`: a flagged video failed (its script failed, its upload failed, or the
  checkout has no script for it), the secret is missing, or the recording
  settings could not be read.

## Options

- `-c, --config <path>`: the workspace's `screenci.config.ts`.
- `-v, --verbose`: print the underlying command output.

## Related pages

- [CI Setup](/docs/ci-setup) for the pipeline templates and the secret.
- [Project files and layout](/docs/guides/project-files) for which files a
  video needs.
- [Hosted recording](/docs/guides/hosted-recording) to record flagged videos
  without a pipeline.
