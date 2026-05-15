---
title: Getting Started
description: Install screenci, check prerequisites, and initialize your project.
---

# Getting Started

screenci records product videos from code. Scripts are Playwright test files — you write interactions, screenci handles the camera, cues, and narration.

## Prerequisites

You need **Node.js** and **Podman** (or Docker) installed. Node.js runs screenci scripts; Podman or Docker provides the isolated environment for recording. **Node.js 20+** is recommended, as well as **Podman 5+** or **Docker 28+**.

<!-- OS_SPECIFIC_PREREQUISITES_HERE -->

## Initialize a project

```bash
npx screenci@latest init
```

You'll be prompted for a project name. screenci then creates the directory, scaffolds the project, and prints what to do next.

## Continue to part 2

- [Getting started part 2](/guides/getting-started-part-2) — write a video, record it, configure rendering, and inspect project info

---

## Next steps

- [Getting started part 2](/guides/getting-started-part-2) — write a video, record it, configure rendering, and inspect project info
- [Writing video tests](/reference/video-tests) — `hide()`, `autoZoom()`, `createNarration()`
- [Configuration reference](/reference/configuration) — all config options
- [API reference](/reference/api-overview) — full function signatures
- [CLI command reference](/reference/cli) — all CLI commands and options
