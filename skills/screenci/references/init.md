# `screenci init`

Use `screenci init` to scaffold a new ScreenCI project.

## Commands

```bash
npx screenci init
npx screenci init "My Project"
npx screenci init "My Project" --verbose
```

## What It Creates

`screenci init` creates a ready-to-run project containing:

```text
screenci/
  screenci.config.ts
  videos/
    example.video.ts
  Dockerfile
  package.json
  .gitignore
.github/workflows/screenci.yaml (optional)
```

## Requirements

- Node.js 20+ recommended
- Podman 5+ recommended, or Docker 28+

## Notes

- If no name is passed, the command prompts for one.
- The name is used as the ScreenCI project display name. Files are always created in `screenci/`.
- `--verbose` shows more setup output.
- After scaffolding, run `npm install`.
- The image is fetched on demand when you run `record` or `test`.

## Typical Flow

```bash
npx screenci init "My Project"
cd screenci
npm install
npx screenci test   # verify the video works
npx screenci record # capture the final recording
```
