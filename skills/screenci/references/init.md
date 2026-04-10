# `screenci init`

Use `screenci init` to scaffold a new ScreenCI project.

## Commands

```bash
npx screenci init
npx screenci init my-project
npx screenci init my-project --verbose
```

## What It Creates

`screenci init` creates a ready-to-run project containing:

```text
my-project/
  screenci.config.ts
  videos/
    example.video.ts
  Dockerfile
  package.json
  .gitignore
  .github/workflows/record.yml
```

## Requirements

- Node.js 20+ recommended
- Podman 5+ recommended, or Docker 28+

## Notes

- If no name is passed, the command prompts for one.
- `--verbose` shows more setup output.
- After scaffolding, run `npm install`.

## Typical Flow

```bash
npx screenci init my-project
cd my-project
npm install
npx screenci dev
```
