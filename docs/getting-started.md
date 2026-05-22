---
title: Getting Started
description: Install screenci, initialize your project, test the video script, and record the final video.
---

# Getting Started

This guide shows how to check prerequisites, initialize a ScreenCI project, test the generated video script, and record the final video with subtitles.

## Prerequisites

You only need **Node.js** and **npm**. npm is included with the standard Node.js installer.

If you are unsure whether Node.js is installed, check:

```bash
node --version
```

If that command is missing or prints an old version, install Node.js from the [official Node.js installation docs](https://nodejs.org/en/download). Node.js 20+ is recommended.

## Initialize a project

```bash
npx screenci@latest init
# Then follow the printed next steps, including the generated project directory.
```

You'll be prompted for a project name. screenci scaffolds the project and prints what to do next.

`screenci init` supports both standalone ScreenCI projects and adding ScreenCI to an existing repository:

- **Standalone project** creates a new directory named after your project and optionally puts the GitHub Action that records videos inside that directory.
- **Part of existing repository** creates `screenci/` and puts the optional GitHub Action that records videos at the repository root in `.github/workflows/screenci.yaml`.

After initialization, change into the project directory that was just created. Use `cd screenci` for an existing repository setup, or `cd your-project-name` for a standalone project.

## Video scripts

ScreenCI automatically creates `videos/example.video.ts` during initialization. This guide continues with that generated example so you can test the script and record your first video before writing your own flow.

Next, continue with [Create Videos](/guides/creating-videos) to understand the generated files, the GitHub Actions workflow, and whether to edit the script manually or with an AI agent.

## Test the script

Inside the ScreenCI project directory, verify the starter video script works before recording:

```bash
npm run test
```

This is similar to running `playwright test`: it executes the `.video.ts` script without recording, so you can quickly check that the video script works before recording.

## Record

Inside the ScreenCI project directory, record the final video when the script is working:

```bash
npm run record
```

ScreenCI records the browser and sends the raw video to `app.screenci.com` for final rendering and optional deployment.

If you initialized with the GitHub Action, recording can also run automatically in GitHub Actions when you push to the repository.

---

## Next steps

- [Playwright vs ScreenCI](/reference/playwright-vs-screenci) — compare Playwright tests with ScreenCI video scripts
- [Create Videos](/guides/creating-videos) — understand the generated files and write your own videos
- [Writing video tests](/reference/video-tests) — `hide()`, `autoZoom()`, `createNarration()`
- [Configuration reference](/reference/configuration) — all config options
- [API reference](/reference/api-overview) — full function signatures
- [CLI command reference](/reference/cli) — all CLI commands and options
