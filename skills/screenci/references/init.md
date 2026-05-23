# `screenci init`

Use `screenci init` to scaffold a new ScreenCI project.

## Commands

```bash
npx screenci init
npx screenci init "My Project"
npx screenci init "My Project" --verbose
```

## What It Creates

`screenci init` creates a ready-to-run project in the current directory containing:

```text
screenci.config.ts
videos/
  example.video.ts
package.json
.gitignore
.github/workflows/screenci.yaml (optional)
```

## Requirements

- Node.js 20+ recommended

## Notes

- If no name is passed, the command prompts for one and defaults to the current directory name.
- The name is used as the ScreenCI project display name. Files are always created in the current directory.
- `--yes` accepts the defaults.
- `--agent <name>` is passed to the selected skills install command.
- `--verbose` shows more setup output.
- `record` uses local Playwright.

## Typical Flow

```bash
npx screenci init "My Project"
npx screenci test   # verify the video works
npx screenci record # capture the final recording
```
