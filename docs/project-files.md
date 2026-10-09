# Project Files and Layout

ScreenCI stores a project's `screenci/` files one file at a time, so an edit,
a pull, or a hosted run touches only the files one video needs. That works
when the workspace follows a simple layout: **one video per script file**,
with the files only that video uses in a folder named after it, and the files
several videos use in a shared folder.

#### You will learn

- [the layout](#the-layout)
- [which files a video needs](#which-files-a-video-needs)
- [what is stored and when](#what-is-stored-and-when)
- [scripts that do not follow the layout](#scripts-that-do-not-follow-the-layout)
- [what is never stored](#what-is-never-stored)
- [who may change which files](#who-may-change-which-files)

## The layout

```
screenci/
  screenci.config.ts          shared
  package.json                shared
  tsconfig.json               shared
  package-lock.json           shared (or pnpm-lock.yaml, yarn.lock)
  recordings/
    add-a-lead.screenci.ts    one video
    add-a-lead/               that video's own files (only when it has some)
      callout.html
    onboarding.screenci.ts    one video
    shared/                   files several videos use
      theme.ts
      logo.png
```

- A script is `recordings/<name>.screenci.ts` and declares exactly one video
  (or one screenshot). `<name>` uses letters, digits, `.`, `-` and `_`, and
  cannot be `shared`.
- A video gets its own folder `recordings/<name>/` only when it has files of
  its own (overlays, media, helpers). No folder is needed otherwise.
- `recordings/shared/` holds what several videos use: the overlay theme,
  shared components, a logo, helper modules.
- Scripts reference files relative to themselves, as before:
  `./add-a-lead/callout.html`, `./shared/theme.ts`.

`screenci init` scaffolds this layout: `recordings/example.screenci.ts` (one
video), `recordings/example-screenshot.screenci.ts` (one screenshot), and the
logo under `recordings/shared/`.

## Which files a video needs

The files a video needs are, with no import analysis:

1. every root file that exists (`screenci.config.ts`, `package.json`,
   `tsconfig.json`, the lockfile, `pnpm-workspace.yaml`, `.yarnrc.yml`,
   `.prettierrc`, `.gitignore`, `README.md`),
2. everything under `recordings/shared/`,
3. its script `recordings/<name>.screenci.ts`,
4. everything under `recordings/<name>/`.

The folder convention is the contract: a helper one video imports from
another video's folder is not part of the first video's files, so keep such
helpers in `recordings/shared/`.

## What is stored and when

After `screenci preview` or `screenci export` records, the CLI stores the
files of every recorded video whose script follows the layout:

- Each file is identified by the SHA-256 hash of its bytes. The CLI asks which
  hashes ScreenCI lacks and uploads only those, so an unchanged project
  uploads nothing but the list.
- The video's current files then point at those hashes. Files of that video
  that no longer exist locally are dropped from its current files; shared
  and root files are never dropped by one video's run.
- Each recording remembers exactly which files (paths and hashes) it was
  recorded from. The video page shows them, and an Edit or Re-record prompt
  made from a version starts from exactly those files.
- Media files (images, video, audio, fonts) are stored too, so a pulled or
  hosted workspace has them even when your `.gitignore` keeps them out of
  git.

Storing is best effort: when it fails, the CLI warns and the recording still
uploads; the next run retries. Set `uploadSources: false` in
`screenci.config.ts` to store nothing (prompts must then run inside the
repository). Anonymous previews never store files.

`screenci setup` pulls files the same way: only the files whose local copy
differs are downloaded, and every download is checked against its hash.

## Scripts that do not follow the layout

Local and CI recordings work with any layout. A script that does not follow
this one (several videos in one file, a script in a subfolder of
`recordings/`) is simply not stored: one warning per run lists those scripts,
and their recordings still upload as usual. Such videos cannot be edited from
the app or recorded hosted until their script is moved to its own
`recordings/<name>.screenci.ts`.

To split a file with several videos, give each video its own script, move
files only one video uses into `recordings/<name>/`, and move the rest into
`recordings/shared/` (updating the relative paths in the scripts).

## What is never stored

- Env files (`.env`, `.env.*`) and signed-in sessions (`storageState*.json`,
  `.screenci/auth/`).
- `.npmrc` (it can carry registry tokens), hidden files and folders.
- `node_modules`, `.screenci`, `dist`, `exports`, and Playwright output.
- Anything outside `recordings/` other than the root files above.
- Text files over 1 MB and media files over 10 MB (skipped with a warning).

Your `.gitignore` is honoured for text files. Media is stored even when it is
ignored, because the scaffolded `.gitignore` leaves media out of git
precisely so that ScreenCI holds it instead.

## Who may change which files

The root files decide what installs and runs, so only organisation members
with the developer or admin role may change them. Scripts, video folders,
and `recordings/shared/` can be changed by any member.

The same rule applies to the CLI: when a run's key belongs to someone
without the developer role and the workspace's root files differ from the
ones ScreenCI holds, the CLI keeps ScreenCI's copies, stores the video's
other files, and warns that root file changes need a developer. The
recording itself uploads as usual.

## Related pages

- [`screenci ci`](/docs/screenci-ci) records the flagged videos in a pipeline.
- [Hosted recording](/docs/guides/hosted-recording) records a video from its
  stored files on ScreenCI's machines.
- [CLI: file storage](/docs/reference/cli#file-storage).
