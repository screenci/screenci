# AI Context

Tell the agent once, for the whole team. Coding agents make the best videos
when they know where your product runs, whether they may start it, and
whether it sits behind a login. The **AI context** page in
the web app (top-right menu) stores that once for the whole organisation, so
a marketer's Add video prompt and an engineer's Add to CI prompt start from
the same facts and nobody types them into a prompt.
Projects can override each field. `screenci setup` reads it all when an agent
runs a setup prompt.

No credential is ever part of it. Signing in to your own product happens on
your own machine, in a browser you drive yourself, and ScreenCI never receives
what you type: see [Signing In](/docs/guides/signing-in).

#### You will learn

- [what the fields mean](#the-fields)
- [how a project overrides the organisation](#project-overrides)
- [what the agent does with the repository](#the-repository)
- [what happens when the site is not running](#running-the-app-locally)
- [how the agent finds out the site needs a sign-in](#sites-that-need-a-sign-in)
- [what each version records about the site it ran against](#site-metadata)

## The fields

| Field                           | What the agent does with it                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Site URL**                    | The address to record: a deployed site, or a `localhost` address for a dev server. Prefills the App URL field of every prompt dialog.                                  |
| **Let the agent start the app** | Off by default. When a localhost site does not answer, the agent stops and reports. On, the agent reads the repository, starts the dev server, and records.            |
| **This site needs a sign-in**   | Off by default. On, the brief tells the agent to run `screenci login` and have you sign in before it starts authoring, instead of discovering the login page later.    |
| **Notes for the agent**         | Free text, up to 4000 characters: how to run the app, which demo workspace to use, flows to avoid, vocabulary. Printed to the agent verbatim as "Notes from the team". |

Any member can edit the organisation values. The agent can re-read them at any
time with [`screenci context`](/docs/reference/cli#screenci-context). The look
and voice new videos start from is a separate page, see
[Branding](/docs/guides/branding); the brief also lists the shared image and
video assets the code can reference by name.

On a production site the agent asks you before any step that acts on the real
world (an order, a payment, an email, a deletion). Use the notes to say up front
which flows are safe there (a sandbox account, a test payment method) or which
to avoid, and it will not need to ask.

## Project overrides

The **AI context** button on a project page opens the same form with an
**Override for this project** toggle per field. A field without the toggle
inherits the organisation value (shown as its placeholder). The project's
site URL override is the same value the prompt dialogs remember as the app
URL.

## The repository

ScreenCI never stores a repository URL and never clones anything. The prompts
are meant to be pasted into a coding agent running inside the product's
repository, and `screenci setup` uses the repository it is run in:

1. When the current folder is inside a git repository, that checkout is the
   product's: the brief tells the agent to read its routes, components, and
   README, and the workspace the checkout holds for this project (its
   `screenci/` folder, or wherever a monorepo keeps it; the config's
   `projectId` says which project it belongs to) is the workspace.
2. Outside any repository the brief says so and the agent works from the site
   alone, exploring it with the playwright-cli skill before writing
   selectors. The workspace is `./screenci`, filled from the sources of the
   version the prompt was made from (or the project's latest, or scaffolded
   for a new project). When those scripts point at a dev server (an engineer
   edited them inside the repository), the brief has the agent point that
   video at the site URL set here (`video.use({ baseURL })`) and record
   against it. Set the
   site URL so this never needs anyone's attention.

A project whose scripts ScreenCI holds no copy of (`uploadSources: false`)
needs the prompt run inside the repository, where the agent finds the
scripts and commits its change on a branch.

## Running the app locally

`setup` probes the site URL (the prompt's App URL, else the AI context's site
URL). Any HTTP answer counts, including a login page. When nothing answers:

- **Localhost address, "Let the agent start the app" off:** the brief says
  **STOP**, the JSON line carries `"stop": {"reason": "site-unreachable-local"}`,
  and the command exits with code 2. The workspace is prepared anyway; the
  agent reports the reason, and rerunning the same command on the same machine
  continues once the app is running (or the setting is on).
- **Localhost address, setting on, repository available:** the brief tells the
  agent to read the repository's README and package.json, start the dev
  server on that address, and prefer configuring it as `webServer` in
  `screenci/screenci.config.ts` so later runs and CI start it the same way.
- **Deployed address:** STOP with `site-unreachable`, unless the agent passes
  `--skip-site-check`.

## Sites that need a sign-in

You sign in to your own product once, in a browser ScreenCI opens for you, and
every recording replays that session. The full flow is in
[Signing In](/docs/guides/signing-in); what matters here is the switch.

Turn **This site needs a sign-in** on and the brief tells the agent, before it
writes anything, to:

1. run `npx screenci login`,
2. ask you to sign in in the browser that opens,
3. run `npx screenci login --done` once you say you have,
4. and then write the video with no sign-in steps in it.

Leave it off and the brief still explains the flow, but as something to reach
for only if the agent runs into a login page.

Either way, the agent never asks you for a password or a code, and nothing you
type reaches ScreenCI. Use a demo or test account where you can: the video
shows whatever that account sees.

CI cannot open a browser, so it is handed a session instead. See
[CI Setup](/docs/ci-setup).

## Site metadata

Every recording stores the origin of the first page it opened (scheme, host,
and port, never the path) and whether that is a local address (`localhost`,
`*.localhost`, loopback, and private network ranges) or a deployed one. Run
pages show it as "Recorded against a local app at localhost:3000" or "Recorded
against app.example.com".

It also records who started the app when known: `started by the recording
config` when `webServer` is set in `screenci.config.ts`, or `started by the
agent from the repository` when the agent ran `preview` with
`SCREENCI_APP_LAUNCHED_BY=agent` (see
[Configuration](/docs/reference/configuration)).

## What's next

- [Make videos by prompt](/docs/make-videos) for the prompt flow itself.
- [Repository and CI](/docs/repository-and-ci) for the engineering hand-off.
- [Signing In](/docs/guides/signing-in) for recording an app behind a login.
- [CLI](/docs/reference/cli) for `setup`, `context`, and `login`.
