---
title: Updating screenci
description: Update the screenci package and refresh installed skills.
---

# Updating screenci

To update `screenci` and refresh your lockfile, run this inside your project:

```bash
npm install screenci@latest
```

This updates `package.json` to the latest published version and installs it.

If you installed the ScreenCI skill during `screenci init`, refresh it after updating the package:

```bash
npx --yes skills add screenci/screenci --skill screenci -y
```

If you also installed the optional `playwright-cli` skill for AI authoring from URLs, refresh both skills:

```bash
npx --yes skills add screenci/screenci --skill screenci --skill playwright-cli -y
```

If you also want to update Playwright at the same time, run:

```bash
npm install screenci@latest @playwright/test@latest
```

The `screenci` CLI runs your videos through `playwright test`, so keeping both packages up to date is recommended.

After updating, verify your project still works:

```bash
npm run test
```
