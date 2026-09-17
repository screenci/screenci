# Who Does What

ScreenCI is one video library for the whole SaaS team. Everyone uses the same
buttons and the same browser editor; the difference is which buttons you
reach for and what you never have to do again. This page walks through the
three roles that make most product videos. Every button below is described
in [Make videos by prompt](/docs/make-videos), and the
[Prompt cookbook](/docs/prompt-cookbook) has example descriptions for each.

#### You will learn

- [product marketing and growth](#product-marketing)
- [docs, support, and customer education](#docs-and-support)
- [engineering](#engineering)
- [which button belongs to whom](#the-buttons-by-role)

## Product marketing

**Goal:** the launch video ships the same day as the feature, in your
branding, in every market's language, at a link you embed once.

What you do:

- **Add project** or **Add video** with one sentence about the feature. The
  agent records your real app, and the tab opens the video.
- **Edit** in the browser: rewrite a narration line, swap the voice, move an
  overlay, cut a slow section. Nothing to prompt for.
- **Add a language** from the language menu: pick the language, paste the
  prompt, and the localized version records on the localized page. See
  [Languages](/docs/guides/languages).
- **Export** the finished version and share its
  [public URL](/docs/guides/public-urls-and-embeds). The link always serves
  the version you selected, so an update never means a new embed.

What you never do: schedule a recording session, wait for an engineer to be
free, re-export the same video in six languages by hand.

## Docs and support

**Goal:** help-center walkthroughs and docs screenshots that stay correct
after every release.

What you do:

- **Add video** for each flow customers ask about, in the words they use:
  "how to invite a teammate and set their role".
- **Add screenshot** for docs figures and README images. A still from the
  same script, branded and cropped, re-captured whenever the UI changes. See
  [Screenshots](/docs/guides/screenshots).
- **Edit** narration and subtitles in the browser when the wording changes.
- **Re-record** a video after the product changed under it: one click when
  CI records the project, a prompt otherwise. The script is only touched
  where the product changed.

What you never do: notice a stale video from a customer ticket. Once an
engineer has done [Add to CI](/docs/repository-and-ci), the pipeline
re-records the videos on every push, and a flow that broke fails the run.

## Engineering

**Goal:** own zero video tooling, and never record a video yourself.

What you do:

- **Add to repository** once. The agent commits the `screenci/` scripts to
  the product repository and opens a pull request. From then on the videos
  live with the code and every one is a Playwright E2E test.
- **Add to CI** once. The agent stores a project-scoped key in your CI
  provider, adds a pipeline that records on every push, and triggers the
  first run. Any provider works.
- Review the pull requests the agent opens when a teammate's **Edit** or
  **Add video** prompt ran inside the repository. See
  [Repository and CI](/docs/repository-and-ci).
- When you prefer to start in the repository yourself, paste the
  [integration prompt](/docs/agent-integration) into the agent there, or
  write the [scripts by hand](/docs/video-script-basics).

What you never do: record, edit, or localize a video. A stale video is a
failed CI run, which you fix like any other broken test: click **Edit** on
the video and describe the change, or fix the script.

## The buttons by role

| Button                | Marketing | Docs and support | Engineering |
| --------------------- | :-------: | :--------------: | :---------: |
| Add project           |    yes    |       yes        |     yes     |
| Add video             |    yes    |       yes        |     yes     |
| Add screenshot        |    yes    |       yes        |             |
| Edit (prompt)         |    yes    |       yes        |     yes     |
| Edit in the browser   |    yes    |       yes        |             |
| Add a language        |    yes    |       yes        |             |
| Record all, Re-record |    yes    |       yes        |     yes     |
| Add to repository     |           |                  |     yes     |
| Add to CI             |           |                  |     yes     |
| Export, public URL    |    yes    |       yes        |             |

Every button is available to every member; the table shows who usually
clicks it. Set [AI context](/docs/guides/ai-context) and
[Branding](/docs/guides/branding) once and every prompt in the organisation
starts from them.

## What's next

- [Make videos by prompt](/docs/make-videos) for how each button works.
- [Prompt cookbook](/docs/prompt-cookbook) for descriptions that get a good
  first take.
- [Repository and CI](/docs/repository-and-ci) for the engineering hand-off.
