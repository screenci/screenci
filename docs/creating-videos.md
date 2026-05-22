---
title: Create Videos
description: Understand the files created by screenci init and the normal workflow for writing, testing, and recording videos.
---

# Create Videos

After following [Getting Started](/guides/getting-started), ScreenCI gives you a small ready-to-edit project. This guide explains what each generated file is for and how to go from the starter example to your own final video.

## What init creates

Standalone projects create a new directory. Existing-repository setups create `screenci/` inside your repo. In both cases, the generated files are the same:

```text
screenci/
  screenci.config.ts
  package.json
  tsconfig.json
  README.md
  .gitignore
  .env
  videos/
    example.video.ts
.github/workflows/screenci.yaml (optional)
```

- `screenci.config.ts` defines the ScreenCI project name, where video files live, which `.env` file to read, and default recording settings like aspect ratio, quality, and FPS. See the [configuration reference](/reference/configuration).
- `package.json` declares the ScreenCI and Playwright dependencies used by the generated project.
- `tsconfig.json` enables strict TypeScript for your video scripts.
- `README.md` summarizes the normal workflow for the generated project.
- `.gitignore` keeps generated output, dependencies, and secrets out of git.
- `.env` is an empty placeholder for local environment variables such as `SCREENCI_SECRET`.
- `videos/example.video.ts` is the starter video script you can modify, duplicate, or replace with your own `*.video.ts` files.

## The starter video file

`videos/example.video.ts` shows the basic ScreenCI authoring model:

- `video()` defines one recorded video.
- `hide()` keeps setup steps out of the visible recording.
- `autoZoom()` adds camera movement during important steps.
- `createNarration()` defines typed narration cues.

See [Writing Video Tests](/reference/video-tests) for the authoring model and [API reference](/reference/api-overview) for function signatures.

## The GitHub Actions workflow

If you choose the optional GitHub Actions setup, ScreenCI also creates `.github/workflows/screenci.yaml`.

That workflow:

- runs on pushes to `main`
- can also be started manually with `workflow_dispatch`
- installs dependencies with `npm ci`
- installs Chromium for Playwright when needed
- runs `npx screenci record`
- uses `SCREENCI_SECRET` from GitHub Actions secrets so recordings can be uploaded from CI

This means the same final recording command works both locally and in CI.

## Create your own videos

You can create videos in two common ways:

- Manual editing: open `videos/example.video.ts` or create a new `videos/your-video.video.ts` file and write the flow yourself.
- AI-supported editing: ask a coding agent to inspect your app or a deployed URL, then create or update the video script for you.

For AI workflows, see [AI-Supported Editing](/guides/ai-editing).

For manual authoring, the usual pattern is:

1. Start from `videos/example.video.ts` or add a new `*.video.ts` file.
2. Use normal Playwright page actions plus ScreenCI helpers like `hide()`, `autoZoom()`, and `createNarration()`.
3. Keep iterating until the visible flow looks right.

## Verify the script

Before recording, make sure the script works locally:

```bash
npx screenci test
```

This runs the video script without the full recording pipeline, so it is the fastest way to confirm selectors, timing, and navigation.

## Record the final result

When the script looks correct, record the final result:

```bash
npx screenci record
```

This is the same command used by the optional GitHub Actions workflow.

## Related docs

- [Getting Started](/guides/getting-started)
- [AI-Supported Editing](/guides/ai-editing)
- [Writing Video Tests](/reference/video-tests)
- [Configuration reference](/reference/configuration)
- [CLI command reference](/reference/cli)
- [API reference](/reference/api-overview)
