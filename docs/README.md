# Screenci Docs

Developer documentation for the `screenci` library.

## Prerequisites

Before using screenci you need:

- **Node.js** — check the installed version; Node.js 20+ is recommended, and see the [official Node.js installation guide](https://nodejs.org/en/download) if you need to install it
- **Podman or Docker** — Podman 5+ or Docker 28+ is recommended; on macOS, install Podman from podman.io or use the community-maintained Homebrew package if you prefer

### macOS

```bash
node --version # Node.js 20+ recommended
podman --version # Podman 5+ recommended
docker --version # alternatively: use this if Podman is missing; Docker 28+ recommended
# Node.js install guide: https://nodejs.org/en/download
# Podman install guide: https://podman.io/docs/installation#macos
```

### Windows

```powershell
node --version # Node.js 20+ recommended
podman --version # Podman 5+ recommended
docker --version # alternatively: use this if Podman is missing; Docker 28+ recommended
# Node.js install guide: https://nodejs.org/en/download
# Podman install guide: https://podman.io/docs/installation#windows
```

### Linux/WSL2

```bash
node --version # Node.js 20+ recommended
podman --version # Podman 5+ recommended
docker --version # alternatively: use this if Podman is missing; Docker 28+ recommended
# Node.js install guide: https://nodejs.org/en/download
# Podman install guide: https://podman.io/docs/installation#ubuntu
```

## Contents

| Doc                                              | Description                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| [Introduction](./intro.md)                       | Overview of ScreenCI and where to start                           |
| [Getting Started](./getting-started.md)          | Install screenci, scaffold a project, and record your first video |
| [Recording Flows](./recording.md)                | Write polished product video scripts with captions and zoom       |
| [Deployment Automation](./automation.md)         | Automate rendering and updates in CI/CD                           |
| [Editing by Typing](./editing.md)                | Update scripts and narration without full reshoots                |
| [AI-Supported Editing](./ai-editing.md)          | AI-facing docs access, llms.txt, and MCP workflows                |
| [Localization & Voiceovers](./localization.md)   | Multi-language narration and localized UI videos                  |
| [Assets](./assets.md)                            | Image and video overlays with `createAssets`                      |
| [Public URLs](./public-urls.md)                  | Publish stable public video, thumbnail, and subtitle URLs         |
| [Prerequisites: macOS](./prerequisites-mac.md)   | macOS setup steps for Node.js and Podman                          |
| [Prerequisites: Windows](./prerequisites-win.md) | Windows setup steps for Node.js and Podman                        |
| [Prerequisites: Linux](./prerequisites-linux.md) | Linux setup steps for Node.js and Podman                          |
| [Configuration](./configuration.md)              | `defineConfig` options, per-test overrides, defaults              |
| [Writing Video Tests](./video-tests.md)          | How to use `video()`, `caption()`, multiple tests, auth, etc.     |
| [API Reference](./api.md)                        | Full reference for all exported functions and types               |
| [Public API](./public-api.md)                    | Public endpoints for published videos, thumbnails, and subtitles  |
