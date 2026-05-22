---
title: AI-Supported Editing
description: Create ScreenCI videos with AI coding agents from source code or a deployed site.
---

# AI-Supported Editing

ScreenCI works well with coding agents that can read files, edit TypeScript, and run terminal commands. Good options include [OpenCode](https://opencode.ai), [Pi](https://pi.dev/), [Codex](https://openai.com/codex/), [Claude Code](https://www.anthropic.com/claude-code), and [GitHub Copilot](https://github.com/features/copilot).

## Create videos from source code

This is usually the best setup when the app you want to show already lives in the same repository.

Start by following [Getting Started](/reference/getting-started), but choose the existing-repository setup instead of the standalone setup.

Recommended flow:

1. Run `npx screenci@latest init` in your existing repository.
2. Choose the existing-repository setup.
3. If you want the AI setup installed automatically, use `npx screenci@latest init --install`.
4. If you also want URL-based browser inspection, use `npx screenci@latest init --install --skill`.
5. Open the repository root in your editor, not just `screenci/`, so the agent can see both your app code and the generated ScreenCI files.

That setup gives the agent direct access to your app source plus the ScreenCI project in `screenci/`.

When prompting the agent, point it at the app code it should study. For example:

```text
Create a ScreenCI video that shows the onboarding flow.

Use the screenci skill.
Look at @src/routes/onboarding, @src/components/signup-form.tsx, and @screenci/videos/.
Start from the real UI in the source code, create or update a .video.ts file, add narration, and keep setup hidden.
Run npm run test until the video is ready, then run npm run record to get the final video output.
```

This flow is usually faster and more reliable than browser-only exploration because the agent can inspect routes, labels, component names, and state logic directly from source.

## Create videos from a deployed site

This is usually the best setup when you want to create videos from a live URL and do not have the app source code in the same repo.

Start by following [Getting Started](/reference/getting-started), but choose the standalone setup instead of the existing-repository setup.

Recommended flow:

1. Run `npx screenci@latest init "My Site" --install --skill`.
2. `cd` into the generated project directory.
3. Open that new ScreenCI project in your editor.
4. Ask the agent to inspect the real site first, then create the video script.

Example:

```bash
npx screenci@latest init "My Site" --install --skill
cd my-site
```

In this setup, the optional `playwright-cli` skill is especially useful because the agent can inspect the live page, discover selectors, and confirm the real flow before editing `videos/*.video.ts`.

Example prompt:

```text
Create a ScreenCI video for https://www.screenci.com/ that shows how to find the docs.

First inspect the live site with playwright-cli. Figure out the cleanest visible path to the docs, including any cookie banner handling that should stay inside hide().
Then use the screenci skill to create a narrated video script in videos/ that starts on the requested page, explains what the user is doing, and uses visible clicks for navigation.
Run npm run test until the video is ready, then run npm run record to get the final video output.
```

## Recommended setup

For AI-assisted authoring, the recommended setup is:

```bash
npx screenci@latest init --install
```

If the agent also needs to inspect live URLs, use:

```bash
npx screenci@latest init --install --skill
```

What these options are for:

- `--install` installs the ScreenCI skill, npm dependencies, and Chromium without extra prompts.
- `--skill` answers yes to the AI authoring prompt and also includes `playwright-cli`.

If you already initialized the project without skills, you can add them later:

```bash
npx --yes skills add screenci/screenci --skill screenci -y
```

Or add both ScreenCI and `playwright-cli`:

```bash
npx --yes skills add screenci/screenci --skill screenci --skill playwright-cli -y
```

## Which skill to use

ScreenCI ships with two useful skills for AI agents:

- `screenci`: use this when the agent is editing `videos/*.video.ts`, `screenci.config.ts`, or running the normal ScreenCI workflow in an already initialized project.
- `playwright-cli`: use this first when the task starts from a live URL and the agent needs to inspect the real page flow and selectors.

A simple rule:

- If the agent has the app source code, start with the `screenci` skill.
- If the agent starts from a deployed site, start with `playwright-cli`, then switch to `screenci` to write the video.

## Prompting tips

Good prompts usually include:

- the page or flow to show
- the source files or URL to inspect
- where the video script should be created
- a reminder to add narration
- a reminder to keep setup hidden with `hide()`
- a reminder to iterate with `screenci test`

Example prompt for a source-code workflow:

```text
Create a ScreenCI video for our pricing flow.

Use the screenci skill.
Inspect @src/routes/pricing.tsx and @src/components/pricing-selector.tsx.
Create or update a video in @screenci/videos/.
Explain the flow with narration, keep initial setup hidden, and use visible clicks after setup.
Run npm run test until the video is ready, then run npm run record to get the final video output.
```

Example prompt for a deployed-site workflow:

```text
Use playwright-cli to inspect https://www.screenci.com/ and create a ScreenCI video that shows how a user finds the documentation.

After inspection, use the screenci skill and write the final video in videos/find-docs.video.ts with clear narration.
Keep cookie handling and initial setup inside hide().
Use visible clicks for the demo. Run npm run test until the video is ready, then run npm run record to get the final video output.
```

## Docs access for agents

All documentation pages are available as raw markdown by appending `.md` to the URL.

- HTML: `https://docs.screenci.com/reference/playwright-vs-screenci/`
- Markdown: `https://docs.screenci.com/reference/playwright-vs-screenci.md`

This makes it easy for agents to fetch docs directly.

ScreenCI also provides a machine-readable documentation index at [`/llms.txt`](/llms.txt) following the [llms.txt specification](https://llmstxt.org/).

That file is useful when you want an agent to discover the main docs before writing or updating a video.
