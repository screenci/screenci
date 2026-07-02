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
recordings/
  example.screenci.ts
package.json
.gitignore
.github/workflows/screenci.yaml (optional)
```

## Requirements

- Node.js 18+ required

## Notes

- `init` can be run at any time, but it is non-destructive and will not re-initialize an existing project. If the project is already initialized (a `screenci/` directory already exists), it fails on purpose and exits with an error like `screenci/ already exists`. That is expected. Do not delete the existing project to force a re-init: continue working with the project that is already there.
- `init` accepts a one-time setup token as its first positional argument (it looks like `otp_...`, copied from the Get Started or secrets page). With a token, init exchanges it for the org's `SCREENCI_SECRET` and writes it into `screenci/.env`, so `record` uploads immediately on the free tier. The token is single-use and short-lived; a used or expired token falls back to the manual path without failing the scaffold.
- Without a token, init tells you to copy `SCREENCI_SECRET` from the secrets page into `screenci/.env` before the first record. There is no browser sign-in.
- Prefer `--yes` for non-interactive setup. Without it, the command prompts for setup choices and defaults the project name to the current directory name when none is provided. A positional that looks like a setup token is treated as the token, not the project name.
- The name is used as the ScreenCI project display name. Files are always created in the current directory.
- `--yes` accepts the defaults.
- `--agent <name>` is passed to the selected skills install command.
- `--verbose` shows more setup output.
- `record` requires `SCREENCI_SECRET`; it does not bootstrap it.
- `record` uses local Playwright.

## Typical Flow

```bash
npm init screenci@latest otp_your_token -- --yes  # connects the project (writes SCREENCI_SECRET)
npx screenci test   # verify the video works
npx screenci record # capture the final recording and upload
```
