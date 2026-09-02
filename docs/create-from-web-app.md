# Create Videos from the Web App

You do not need a repository, a CI pipeline, or an `.env` file to make a
ScreenCI video. Every org page has **Add project**, every project page has
**Add video**, and every video page has **Edit**. Each button produces a short
prompt with a one-time setup code. Paste the prompt into your coding agent
(Claude Code, Cursor, Codex, or similar) and the agent does the rest: it sets
up a workspace, writes or changes the script, records the live preview, and the
browser tab you started from opens the result.

#### You will learn

- [how the three buttons work](#the-three-buttons)
- [what the agent does with the prompt](#what-the-agent-does)
- [where the video scripts live](#where-the-scripts-live)
- [what happens when the recording lands](#when-the-recording-lands)
- [the limits of the flow](#limits)

## The three buttons

- **Add project** (org page) creates a new project. Describe what the first
  video should show, optionally give the URL of the app to record and a project
  name, and copy the prompt.
- **Add video** (project page) adds a video to a project that was created this
  way. The dialog remembers the project's app URL.
- **Edit** (video page) changes an existing video. Describe what should change
  ("skip the login step", "narrate the export step", "add a zoom on the
  invoice table").
- **Move to repository** (project page) hands the agent the project's scripts
  to commit into your product repository (see
  [AI context](/docs/guides/ai-context#move-to-repository)).

The dialogs prefill the app URL from the organisation's
[AI context](/docs/guides/ai-context) and only ask for a repository URL while
none is known. Set the context once and the prompts need nothing but the
description.

Each prompt looks like this:

```text
Create a product video with ScreenCI by fetching https://screenci.com/add-project.md and following its steps with setup code SC-7K3Q-M9XA. The video should show: signing up and creating the first invoice
```

The brief the prompt points at (`/add-project.md`, `/add-video.md`,
`/edit-video.md`, or `/merge-sources.md`, one per button) is an agent-readable page like
`/integrate.md`: it explains what the code does and how to author or change
the video. The dialog keeps waiting after you copy the prompt: it shows when
the agent connected and, once the recording lands, opens the video.

## What the agent does

`npx screenci@latest start <code>` runs on the agent's machine:

1. **Exchanges the code** for a project-scoped `SCREENCI_SECRET` and a personal
   `SCREENCI_EDIT_TOKEN`, written into `screenci/.env`. The secret can only
   upload to that one project. A code belongs to the first machine that
   exchanges it: rerunning `start` there resumes it until a recording lands,
   another machine is refused, and it expires 24 hours after it was created.
   The dialog can always make a new one.
2. **Locates the product** from the organisation's
   [AI context](/docs/guides/ai-context): uses the current repository when it
   is the configured one, otherwise clones it into `.screenci/repo`; checks
   that the site answers; and writes the person's saved site login into the
   workspace env file as `APP_USERNAME` and `APP_PASSWORD`.
3. **Prepares the workspace**: a `screenci/` folder found inside the
   repository, else `./screenci` in the current folder. A new project is
   scaffolded like `screenci init` does (with the agent skill, without a CI
   workflow). An existing service-managed project is pulled from ScreenCI: its
   scripts and config are written into `./screenci`, dependencies are
   installed, and the Playwright browser is set up. Binary media (overlay
   images, audio) is not downloaded; recordings reuse the assets the project
   already uploaded.
4. **Prints a brief** for the agent: the task you typed, the repository and
   site sections, the login note, the team's notes, which script to edit (for
   an Edit code), the authoring rules, and the commands to run:
   `screenci test`, then `screenci preview "<title>"`. When the site does not
   answer and the agent may not start it, the brief says **STOP** and the
   command exits with code 2; the agent reports the reason instead of
   recording.

The project name of a new project defaults to the folder the agent ran the
command in. The agent can pick a better one with `--name "Acme Billing"`, and
the name typed in the dialog wins over the folder name. Rename the project in
the web app later if needed.

If `./screenci` already exists and belongs to another project, `start`
refuses and suggests `--dir <path>`.

## Where the scripts live

Projects created this way are **service-managed**: every `screenci preview` and
`screenci export` uploads the text sources of the `screenci/` folder (the
config and `recordings/**`; never `.env`, lockfiles, or media) together with
the recording. The next person who clicks **Edit** gets the current scripts on
their own machine, wherever the previous edit happened.

Nothing stops you from also committing the `screenci/` folder to git. The
uploaded copy is what the web app hands out, so if two people edit the same
video from different machines, the later `preview` wins. `start` refuses to
overwrite local changes that differ from the project's latest sources unless
you pass `--force`.

Repository-managed projects (created with `screenci init` and an org-wide
`SCREENCI_SECRET`) keep working exactly as before. They show the Add video and
Edit buttons once the organisation's or project's
[repository URL](/docs/guides/ai-context) is known: the agent then works in the
repository (or a clone of it) and commits its change on a branch instead of
uploading sources. They can also opt into uploading their sources with
`uploadSources: true` in `screenci.config.ts` (see
[Configuration](/docs/reference/configuration)). **Move to repository** turns a
service-managed project into a repository-managed one.

## When the recording lands

The tab that produced the prompt watches for the first run completed with the
new credentials:

- One video, one language: the video's page opens (with the export preselected
  when the agent ran `export`).
- Several videos or several languages: the run page opens, listing each one.

From there the usual tools apply: refine the video in the
[Editor](/docs/editor), export it, share a version with a permanent public URL,
or click **Edit** again to hand the next change to an agent.

## Limits

- **Recording happens on the agent's machine.** The app must be reachable from
  there: a deployed or staging URL, or a dev server the agent may start from
  the repository when the [AI context](/docs/guides/ai-context) allows it.
- **Previews are free; exports need a plan.** The project inherits your
  organization's subscription. `screenci export` without an active paid plan
  refuses, exactly like it does for repository-managed projects.
- **One machine per code.** A second machine needs a new prompt. The
  project-scoped secret stays on the machine that exchanged it, so later runs
  from that machine need no new code.
- **Project-scoped secrets appear on the Secrets page** labelled with their
  project. Delete one there to cut off a machine.

## What's next

- [Editor](/docs/editor) to refine the preview in the browser.
- [Public URLs and Embeds](/docs/guides/public-urls-and-embeds) to publish the
  finished video.
- [AI context](/docs/guides/ai-context) to tell agents about the repository,
  the site, and your notes once.
- [CLI](/docs/reference/cli#screenci-start-code) for the `start` command
  reference.
