**Check Node.js**

Check whether Node.js is already installed and which version is available. Node.js 20 or newer is recommended:

```bash
node --version
```

If Node.js is missing, see the [official Node.js installation guide](https://nodejs.org/en/download). For Linux, for example:

```bash
# Download and install nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash

# in lieu of restarting the shell
\. "$HOME/.nvm/nvm.sh"

# Download and install Node.js:
nvm install

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

If neither is installed, install Podman. See the [Podman installation guide for Linux](https://podman.io/docs/installation#ubuntu). For Ubuntu 20.10 and newer:

```bash
sudo apt-get update
sudo apt-get -y install podman
```

Verify everything after installation:

```bash
node --version # Node.js 20+ recommended
podman --version # Podman 5+ recommended
# alternative for podman: docker --version  # Docker 28+ recommended
```
