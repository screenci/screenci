# `npm init screenci`

Use `npm init screenci` to scaffold a new ScreenCI project.

## Commands

```bash
npm init screenci
npm init screenci "My Project"
npm init screenci "My Project" -- --verbose
```

## What It Creates

`npm init screenci` creates a ready-to-run project in the current directory containing:

```text
screenci.config.ts
videos/
  example.video.ts
package.json
.gitignore
.github/workflows/screenci.yaml (optional)
```

## Requirements

- Node.js 18+ required

## Notes

- If no name is passed, the command prompts for one and defaults to the current directory name.
- The name is used as the ScreenCI project display name. Files are always created in the current directory.
- `--yes` accepts the defaults.
- `--agent <name>` is passed to the selected skills install command.
- `--verbose` shows more setup output.
- `record` uses local Playwright.

## Typical Flow

```bash
npm init screenci "My Project"
npx screenci test   # verify the video works
npx screenci record # capture the final recording
```
