# Screenci Docs

Developer documentation for the `screenci` library.

## Prerequisites

Before using screenci you need:

- **Node.js 18+** — [nodejs.org](https://nodejs.org) or via nvm / Homebrew / winget
- **Docker** (or Podman) — required to run recordings in an isolated container

### macOS

```bash
brew install node
# Docker Desktop: https://docs.docker.com/desktop/install/mac-install/
```

### Windows

```powershell
winget install OpenJS.NodeJS.LTS
# Docker Desktop: https://docs.docker.com/desktop/install/windows-install/
```

### Linux

```bash
# Node.js via nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install --lts

# Docker Engine: https://docs.docker.com/engine/install/
# Add your user to the docker group:
sudo usermod -aG docker $USER && newgrp docker
```

## Contents

| Doc                                     | Description                                                   |
| --------------------------------------- | ------------------------------------------------------------- |
| [Getting Started](./getting-started.md) | Install screenci, scaffold a project, and record your first video  |
| [Writing Video Tests](./video-tests.md) | How to use `video()`, `caption()`, multiple tests, auth, etc. |
| [Configuration](./configuration.md)     | `defineConfig` options, per-test overrides, defaults          |
| [API Reference](./api.md)               | Full reference for all exported functions and types           |
