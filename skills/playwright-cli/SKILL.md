---
name: playwright-cli
description: Automate browser interactions, test web pages and work with Playwright tests.
allowed-tools:
  - Bash(playwright-cli:*)
  - Bash(npx:*)
  - Bash(npm:*)
---

<!--
  Adapted from the "playwright-cli" skill in the Microsoft Playwright CLI project
  (https://github.com/microsoft/playwright-cli), Copyright (c) Microsoft Corporation,
  licensed under the Apache License, Version 2.0. Modified by ScreenCI.
  Full license and attribution: see THIRD_PARTY_NOTICES.md and
  licenses/microsoft-playwright-cli-APACHE-2.0.txt in the screenci package.
-->

# Browser Automation with playwright-cli

## When Inspecting Pages For ScreenCI

- **Simple flow first:** `npx screenci explore <url> --click "<name>"` opens the
  page, clicks through, and prints the snapshot inline in one call. Use
  `playwright-cli` only when you need more steps than that.
- Run `npx playwright-cli ...` from the `screenci/` directory: it is a local
  devDependency there.
- **Never write a Playwright script of your own.** It starts signed out, uses a
  different browser, and finds selectors the recording will never see.
- If the app needs a sign-in, load the session ScreenCI already saved:

  ```bash
  playwright-cli open
  playwright-cli state-load screenci/.screenci/auth/default.json
  playwright-cli goto https://app.example.com
  ```

  When that file does not exist, run `npx screenci login`, have the person sign
  in in the browser it opens, then `npx screenci login --wait`, and load it.
  Never type the person's credentials into this browser, and never save state
  back over that file (`state-save` would overwrite the real session).

- After the first navigation and snapshot, check whether a cookie consent or
  cookie policy banner appeared. Identify the accept action the script should
  use inside its initial
  `hide()` block, preferably a stable locator such as
  `getByRole('button', { name: /accept|accept all|allow all|agree|ok/i })`.
  Prefer accept/allow over dismiss-only or settings actions.
- This browser is the installed Chrome. The recorder uses bundled Chromium
  unless `screenci.config.ts` sets `channel: 'chrome'` in `use`, so a step that
  works here but fails in `npx screenci test` points at the browser, not the
  selector.

## Snapshots

Each command prints the page URL, title, and a snapshot with element refs
(`e15`). Prefer output you can read inline: if your version supports the global
`--raw` option, `playwright-cli --raw snapshot` prints only the snapshot.
Otherwise the output links a `.playwright-cli/*.yml` file; read it only when the
inline summary is not enough.

```bash
playwright-cli snapshot            # whole page
playwright-cli snapshot e34        # one element
playwright-cli snapshot --depth=4  # shallower, cheaper
```

## Core commands

```bash
playwright-cli open [url]
playwright-cli goto https://example.com
playwright-cli click e3
playwright-cli fill e5 "user@example.com"
playwright-cli type "search query"
playwright-cli press Enter
playwright-cli hover e4
playwright-cli select e9 "option-value"
playwright-cli check e12
playwright-cli go-back
playwright-cli reload
playwright-cli eval "el => el.getAttribute('data-testid')" e5
playwright-cli close
```

Targets can also be CSS selectors or Playwright locators:

```bash
playwright-cli click "getByRole('button', { name: 'Submit' })"
playwright-cli click "getByTestId('submit-button')"
```

Named sessions: `playwright-cli -s=mysession open example.com`, then
`playwright-cli list` / `playwright-cli close-all`.

## Installation

If `npx --no-install playwright-cli --version` fails, install it with
`npm install -g @playwright/cli@latest`.
