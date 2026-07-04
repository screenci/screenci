# Third-party notices

This file records third-party material redistributed in this package and is
kept separate from the package's own license (`LICENCE`, MIT) so the two are
not confused. Nothing here is copied into a user's project when a skill is
installed: the skill installer only copies the `skills/<name>/` directories,
and this file plus the `licenses/` directory are excluded from the published
npm package by the `files` allowlist in `package.json`.

## skills/playwright-cli/SKILL.md

`skills/playwright-cli/SKILL.md` is adapted from the `playwright-cli` skill in
the Microsoft Playwright CLI project:

- Source: https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/SKILL.md
- Upstream license: https://github.com/microsoft/playwright-cli/blob/main/LICENSE
- Copyright (c) Microsoft Corporation.
- Licensed under the Apache License, Version 2.0.

The full text of the upstream Apache License 2.0 is included in this repository
at `licenses/microsoft-playwright-cli-APACHE-2.0.txt`.

The file has been modified from the original (for example, a ScreenCI-specific
"When Inspecting Pages For ScreenCI" section was added and the command
reference was trimmed). Per Apache License 2.0 section 4(b), modified files
carry a notice stating that they were changed; see the header comment at the
top of `skills/playwright-cli/SKILL.md`.
