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

**Install Playwright Browsers**

```bash
npx playwright install chromium
```

Verify everything after installation:

```bash
node --version # Node.js 20+ recommended
npx playwright --version
```
