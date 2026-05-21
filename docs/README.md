# Screenci Docs

Developer documentation for the `screenci` library.

## Prerequisites

Before using screenci you only need **Node.js** and **npm**. npm is included with the standard Node.js installer.

If you are unsure whether Node.js is installed, check:

```bash
node --version
```

If that command is missing or prints an old version, install Node.js from the [official Node.js installation docs](https://nodejs.org/en/download). Node.js 20+ is recommended.

## Contents

| Doc                                                   | Description                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| [Introduction](./intro.md)                            | Overview of ScreenCI and where to start                          |
| [Getting Started](./getting-started.md)               | Record video and subtitles from a ScreenCI project               |
| [Playwright vs ScreenCI](./playwright-vs-screenci.md) | Compare Playwright tests with ScreenCI video scripts             |
| [AI-Supported Editing](./ai-editing.md)               | AI-facing docs access, llms.txt, and MCP workflows               |
| [Localization & Narrations](./localization.md)        | Multi-language narration and localized UI videos                 |
| [Assets](./assets.md)                                 | Image and video overlays with `createAssets`                     |
| [Public URLs](./public-urls.md)                       | Publish stable public video, thumbnail, and subtitle URLs        |
| [Update screenci with npm](./updating-with-npm.md)    | Update the installed `screenci` package and refresh skills       |
| [CLI Commands](./cli.md)                              | Complete command reference for `screenci`                        |
| [Configuration](./configuration.md)                   | `defineConfig` options, per-test overrides, defaults             |
| [Writing Video Tests](./video-tests.md)               | How to use `video()`, `cue()`, multiple tests, auth, etc.        |
| [API Reference](./api.md)                             | Full reference for all exported functions and types              |
| [Public API](./public-api.md)                         | Public endpoints for published videos, thumbnails, and subtitles |
