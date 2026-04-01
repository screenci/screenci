These instructions assume you are using [PowerShell](https://learn.microsoft.com/en-us/powershell/). [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) should also work; see the Linux/WSL2 tab for those steps.

**Check Node.js**

Check via PowerShell whether Node.js is already installed and which version is available. Node.js 20 or newer is recommended:

```bash
node --version
```

If Node.js is missing, see the [official Node.js installation guide](https://nodejs.org/en/download). For Windows, for example:

```bash
# Download and install Chocolatey:
powershell -c "irm https://community.chocolatey.org/install.ps1|iex"

# Download and install Node.js:
choco install nodejs

# Verify the Node.js version:
node --version # Should print "v24.xx.x" or later.

# Verify npm version:
npm --version # Should print "11.xx.x" or later.
```

**Check Container Runtime**

Check whether Podman or Docker is already installed. Podman 5 or newer, or Docker 28 or newer, is recommended:

```bash
podman --version
docker --version # alternatively: use this if Podman is missing
```

If neither is installed, install Podman. See the [Podman installation guide for Windows](https://podman.io/docs/installation#windows).

Verify everything after installation:

```bash
node --version # Node.js 20+ recommended
podman --version # Podman 5+ recommended
# alternative for podman: docker --version  # Docker 28+ recommended
```
