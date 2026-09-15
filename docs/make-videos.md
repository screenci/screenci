# Make Videos by Prompt

Anyone in your organisation can make or change a product video: product
marketing, support, docs, engineering. You do not need a repository, a CI
pipeline, or an `.env` file, and you never open the video's code. Every
button in the web app works by a prompt: the org page has **Add project**,
every project page has **Add video**, **Add screenshot**, **Record all**,
**Add to repository**, and **Add to CI**, and every video page has **Edit**,
**Re-record**, and **Add a language**. Each button produces a short prompt
with a one-time setup code. Paste the prompt into your coding agent, and the
agent does the rest: it sets up a workspace, writes or changes the script,
records the live preview, and the browser tab you started from opens the
result.

The three steps are the same for every button:

1. **Describe.** Click the button and type one sentence: what the video
   should show, or what should change.
2. **Paste.** Copy the prompt into your coding agent. It records your real
   app on its own machine.
3. **Watch.** Leave the tab open. It opens the video when the recording
   lands. From there, change narration, voices, and languages in the
   [browser editor](/docs/editor) without any further prompt.

Not sure which button is yours? See [Who does what](/docs/roles) and the
[Prompt cookbook](/docs/prompt-cookbook) for descriptions that work.

#### You will learn

- [which agents work](#which-agent)
- [how the buttons work](#the-buttons)
- [what the agent does with the prompt](#what-the-agent-does)
- [where the video scripts live](#where-the-scripts-live)
- [what happens when the recording lands](#when-the-recording-lands)
- [the limits of the flow](#limits)

## Which agent

Any coding agent or agent harness that can run a shell command works: Claude
Code, Cursor, Codex, a desktop agent app, or one your company runs. More
non-technical people have one every month, and the prompt does not care
which one reads it. The agent needs Node.js on its machine and a way to
reach your product (a deployed URL, or a dev server it may start from the
repository when [AI context](/docs/guides/ai-context) allows it).

If you do not have an agent yet, any teammate who has one can paste the
prompt once. After the first recording lands, edits to narration, voices,
overlays, and languages happen in the [browser editor](/docs/editor), and
[Record all](#the-buttons) is one click once CI records the project.

The agent will only ever ask you for one thing: to sign in to your own
product in a browser window it opens on its machine. It never asks for a
password, a one-time code, or an API key, and ScreenCI never receives what
you type. See [Signing In](/docs/guides/signing-in).

## The buttons

- **Add project** (org page) creates a new project. Describe what the first
  video should show and copy the prompt; the app URL and a project name sit
  under **Advanced**.
- **Add video** (project page) adds a video. Describe what it should show.
- **Add screenshot** (project page) adds a still (a README shot, a docs
  figure, a social card): a silent `screenshot(...)` in the same scripts.
- **Edit** (video or screenshot page) changes an existing one. Describe what
  should change ("skip the login step", "narrate the export step", "crop to
  the sidebar").
- **Add a language** (the language menu on a video page) translates the
  narration into one more language and records it. Pick the language;
  there is nothing to type.
- **Record all** (project page) and **Re-record** (video page, and on every
  card) record again with the scripts as they are. With a connected CI
  trigger one click starts the pipeline; otherwise the prompt has the agent
  trigger your pipeline when the project records from CI, and record on its
  own machine when nothing does. A script is only touched where the product
  changed underneath it.
- **Add to repository** (project and video pages, while ScreenCI holds
  sources the repository does not have) hands the agent the scripts to commit
  into your product repository (see
  [AI context](/docs/guides/ai-context#move-to-repository) and
  [Repository and CI](/docs/repository-and-ci)).
- **Add to CI** (project and video pages, until CI records the project) has
  the agent store a CI key in your CI provider, add a pipeline that records on
  every push, and trigger the first run. Any provider works; see
  [CI Setup](/docs/ci-setup). A project whose sources still live in ScreenCI
  is moved into the repository on the way.

Every dialog is one field (or one picker) plus the prompt to copy. The app
URL, repository URL, and package manager sit under **Advanced**, prefilled
from the organisation's [AI context](/docs/guides/ai-context); only
**Add to repository** and **Add to CI** insist on a repository URL when none
is known. Set the context once and the prompts need nothing but the
description.

Each prompt looks like this:

```text
Create a product video with ScreenCI by fetching https://screenci.com/add-project.md and following its steps with setup code SC-7K3Q-M9XA. The video should show: signing up and creating the first invoice
```

The brief the prompt points at (`/add-project.md`, `/add-video.md`,
`/add-screenshot.md`, `/edit-video.md`, `/add-language.md`,
`/merge-sources.md`, or `/add-to-ci.md`, one per button) is an agent-readable page like
`/integrate.md`: it explains what the code does and how to author or change
the video. The dialog keeps waiting after you copy the prompt: it shows when
the agent connected and, once the recording lands, opens the video.

## What the agent does

`npx screenci@latest start <code>` runs on the agent's machine:

1. **Exchanges the code** for a project-scoped `SCREENCI_SECRET`, written into
   `screenci/.env`. It is the only credential, and it can only
   upload to that one project. A code belongs to the first machine that
   exchanges it: rerunning `start` there resumes it until a recording lands,
   another machine is refused, and it expires 24 hours after it was created.
   The dialog can always make a new one.
2. **Locates the product** from the organisation's
   [AI context](/docs/guides/ai-context): uses the current repository when it
   is the configured one (or already holds the project's `screenci/`
   workspace), otherwise clones it into `.screenci/repo`; checks that the
   site answers; and looks for a signed-in session already saved on the
   machine (see [Signing In](/docs/guides/signing-in)).
3. **Prepares the workspace**: a `screenci/` folder found inside the
   repository, else `./screenci` in the current folder. A new project is
   scaffolded like `screenci init` does (with the agent skill, without a CI
   workflow). An existing service-managed project is pulled from ScreenCI: its
   scripts and config are written into `./screenci`, dependencies are
   installed, and the Playwright browser is set up. Binary media (overlay
   images, audio) is not downloaded; recordings reuse the assets the project
   already uploaded.
4. **Prints a brief** for the agent: the task you typed, the repository and
   site sections, how to sign in, the team's notes, which script to edit (for
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
`SCREENCI_SECRET`) keep working exactly as before. They show the Add video,
Add screenshot, and Edit buttons once the organisation's or project's
[repository URL](/docs/guides/ai-context) is known. When the agent runs the
prompt inside that repository, it commits its change on a branch. When it
runs somewhere else (a machine without the checkout), `start` clones the
repository, the agent records against the site, and `preview` uploads the
changed scripts instead; the project page then offers **Add to repository**
to commit them, and **Add to CI** to record from the pipeline. They can also
opt into uploading their sources permanently with `uploadSources: true` in
`screenci.config.ts` (see [Configuration](/docs/reference/configuration)).
**Add to repository** turns a service-managed project into a
repository-managed one.

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
- [Who does what](/docs/roles) and the [Prompt cookbook](/docs/prompt-cookbook)
  for descriptions per role.
- [Repository and CI](/docs/repository-and-ci) when an engineer wants the
  videos in the repository.
- [Public URLs and Embeds](/docs/guides/public-urls-and-embeds) to publish the
  finished video.
- [AI context](/docs/guides/ai-context) to tell agents about the repository,
  the site, and your notes once.
- [CLI](/docs/reference/cli#screenci-start-code) for the `start` command
  reference.
