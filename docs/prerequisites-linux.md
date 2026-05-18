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

**Install Playwright Browsers**

```bash
npx playwright install chromium --with-deps
```

Verify everything after installation:

```bash
node --version # Node.js 20+ recommended
npx playwright --version
```
