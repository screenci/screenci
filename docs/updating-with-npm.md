---
title: Updating screenci
description: Update the screenci package and refresh installed skills.
---

# Updating screenci

To update `screenci`, `@playwright/test`, and refresh your lockfile, run this inside your project:

```bash
npm install screenci@latest @playwright/test@latest
```

`screenci` uses `@playwright/test` to run your video tests, so keeping both packages up to date is recommended.

This updates both packages in `package.json` to the latest published versions and installs them.

If you installed the ScreenCI skill during `screenci init`, refresh it after updating the package:

```bash
npx --yes skills add screenci/screenci --skill screenci -y
```

If you also installed the optional `playwright-cli` skill for AI authoring from URLs, refresh both skills:

```bash
npx --yes skills add screenci/screenci --skill screenci --skill playwright-cli -y
```

After updating, verify your project still works:

```bash
npm run test
```
