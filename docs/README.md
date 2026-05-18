# Screenci Docs

Developer documentation for the `screenci` library.

## Prerequisites

Before using screenci you need:

- **Node.js** — check the installed version; Node.js 20+ is recommended, and see the [official Node.js installation guide](https://nodejs.org/en/download) if you need to install it
- **Playwright browsers** — installed by `npx playwright install chromium --with-deps`

### macOS

```bash
node --version # Node.js 20+ recommended
npx playwright install chromium --with-deps
# Node.js install guide: https://nodejs.org/en/download
```

### Windows

```powershell
node --version # Node.js 20+ recommended
npx playwright install chromium
# Node.js install guide: https://nodejs.org/en/download
```

### Linux/WSL2

```bash
node --version # Node.js 20+ recommended
npx playwright install chromium --with-deps
# Node.js install guide: https://nodejs.org/en/download
```

## Contents

| Doc                                                   | Description                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| [Introduction](./intro.md)                            | Overview of ScreenCI and where to start                          |
| [Getting Started](./getting-started.md)               | Install screenci, check prerequisites, and initialize a project  |
| [Getting Started Part 2](./getting-started-part-2.md) | Write a video, record it, configure it, and upload it            |
| [Recording Flows](./recording.md)                     | Write polished product video scripts with cues and zoom          |
| [Deployment Automation](./automation.md)              | Automate rendering and updates in CI/CD                          |
| [Editing by Typing](./editing.md)                     | Update scripts and narration without full reshoots               |
| [AI-Supported Editing](./ai-editing.md)               | AI-facing docs access, llms.txt, and MCP workflows               |
| [Localization & Narrations](./localization.md)        | Multi-language narration and localized UI videos                 |
| [Assets](./assets.md)                                 | Image and video overlays with `createAssets`                     |
| [Public URLs](./public-urls.md)                       | Publish stable public video, thumbnail, and subtitle URLs        |
| [CLI Commands](./cli.md)                              | Complete command reference for `screenci`                        |
| [Prerequisites: macOS](./prerequisites-mac.md)        | macOS setup steps for Node.js and Playwright                     |
| [Prerequisites: Windows](./prerequisites-win.md)      | Windows setup steps for Node.js and Playwright                   |
| [Prerequisites: Linux](./prerequisites-linux.md)      | Linux setup steps for Node.js and Playwright                     |
| [Configuration](./configuration.md)                   | `defineConfig` options, per-test overrides, defaults             |
| [Writing Video Tests](./video-tests.md)               | How to use `video()`, `cue()`, multiple tests, auth, etc.        |
| [API Reference](./api.md)                             | Full reference for all exported functions and types              |
| [Public API](./public-api.md)                         | Public endpoints for published videos, thumbnails, and subtitles |
