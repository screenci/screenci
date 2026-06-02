# `npm init screenci`

Use `npm init screenci -- --yes` to scaffold a new ScreenCI project without prompts.

## Commands

```bash
npm init screenci -- --yes
npm init screenci "My Project" -- --yes
npm init screenci "My Project" -- --verbose
```

## What It Creates

`npm init screenci -- --yes` creates a ready-to-run project in the current directory containing:

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

- Prefer `--yes` for non-interactive setup. Without it, the command prompts for setup choices and defaults the project name to the current directory name when none is provided.
- The name is used as the ScreenCI project display name. Files are always created in the current directory.
- `--yes` accepts the defaults.
- `--agent <name>` is passed to the selected skills install command.
- `--verbose` shows more setup output.
- `login` saves `SCREENCI_SECRET` into the project env file before the first remote upload/render.
- `record` uses local Playwright.

## Typical Flow

```bash
npm init screenci "My Project" -- --yes
npx screenci test   # verify the video works
npx screenci login  # save SCREENCI_SECRET for this project
npx screenci record # capture the final recording
```
