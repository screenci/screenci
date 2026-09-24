# AI Context

What the coding agent knows about your product before it records, and how it
gets to know it without anyone filling in a settings page. Coding agents make
the best videos when they know where your product runs, whether it sits
behind a login, and what the team wants them to keep in mind. All of that
lives on the **project page**, under the project's name, and most of it fills
itself in.

No credential is ever part of it. Signing in to your own product happens on
your own machine, in a browser you drive yourself, and ScreenCI never receives
what you type: see [Signing In](/docs/guides/signing-in).

#### You will learn

- [what the agent knows and where it comes from](#what-the-agent-knows)
- [what the agent does with the repository](#the-repository)
- [what happens when the site is not running](#running-the-app-locally)
- [how the agent finds out the site needs a sign-in](#sites-that-need-a-sign-in)
- [what each version records about the site it ran against](#site-metadata)

## What the agent knows

| Fact                    | Where it comes from                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Site URL**            | The address to record: a deployed site, or a `localhost` address for a dev server. Typed once, into the landing page prompt or the **Add project** dialog, or learned from the first recording made against a deployed site. Shown under the project's name on its page, where anyone can edit it. Prompts never ask for it again. |
| **Needs a sign-in**     | Learned from the first recording that started from a saved `screenci login` session. Shown as a badge next to the site URL. The brief then tells the agent to have you sign in before it writes anything.                                                                                                                          |
| **Notes for the agent** | Free text, up to 4000 characters, edited under the project's name: how to run the app, which demo workspace to use, flows to avoid, vocabulary. Printed to the agent verbatim as "Notes from the team".                                                                                                                            |
| **Package manager**     | Never asked. The agent uses the one the repository's lockfile shows.                                                                                                                                                                                                                                                               |
| **Starting the app**    | Never asked. An agent that has the repository may start the dev server when a local site does not answer; without the repository it stops and says so.                                                                                                                                                                             |

Any member can edit the site URL and the notes. The agent can re-read them at
any time with [`screenci context`](/docs/reference/cli#screenci-context). The
look and voice new videos start from is a separate page, see
[Branding](/docs/guides/branding); the brief also lists the shared image and
video assets the code can reference by name.

On a production site the agent asks you before any step that acts on the real
world (an order, a payment, an email, a deletion). Use the notes to say up front
which flows are safe there (a sandbox account, a test payment method) or which
to avoid, and it will not need to ask.

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
   video at the project's site URL (`video.use({ baseURL })`) and record
   against it. Once the project knows its site URL this never needs
   anyone's attention.

A project whose scripts ScreenCI holds no copy of (`uploadSources: false`)
needs the prompt run inside the repository, where the agent finds the
scripts and commits its change on a branch.

## Running the app locally

`setup` probes the site URL (the prompt's live site URL, else the project's).
Any HTTP answer counts, including a login page. When nothing answers:

- **Localhost address, repository available:** the brief tells the agent to
  read the repository's README and package.json, start the dev server on
  that address, and prefer configuring it as `webServer` in
  `screenci/screenci.config.ts` so later runs and CI start it the same way.
  Nobody has to allow this: an agent that has the repository may start the
  app.
- **Localhost address, no repository around:** the brief says **STOP**, the
  JSON line carries `"stop": {"reason": "site-unreachable-local"}`, and the
  command exits with code 2. The workspace is prepared anyway; the agent
  reports the reason, and rerunning the same command on the same machine
  continues once the app is running (or a live site URL is known).
- **Deployed address:** STOP with `site-unreachable`, unless the agent passes
  `--skip-site-check`.

## Sites that need a sign-in

You sign in to your own product once, in a browser ScreenCI opens for you, and
every recording replays that session. The full flow is in
[Signing In](/docs/guides/signing-in); what matters here is how the agent
finds out.

Nobody flips a switch. The first recording that starts from a saved session
marks the project as needing a sign-in (the recording carries only the fact
that a session was used, never the session), and the project page shows a
small **Needs sign-in** badge next to the site URL. From then on the brief
tells the agent, before it writes anything, to:

1. run `npx screenci login`,
2. ask you to sign in in the browser that opens,
3. run `npx screenci login --wait` until you have,
4. and then write the video with no sign-in steps in it.

Before that first recording the brief still explains the flow, but as
something to reach for only if the agent runs into a login page.

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
[Configuration](/docs/reference/configuration)), and whether the run
replayed a saved sign-in session.

This is also how the project learns about itself: a recording against a
deployed site fills in a project's missing site URL, and a recording that
started signed in marks the project as needing a sign-in.

## What's next

- [Make videos by prompt](/docs/make-videos) for the prompt flow itself.
- [Repository and CI](/docs/repository-and-ci) for the engineering hand-off.
- [Signing In](/docs/guides/signing-in) for recording an app behind a login.
- [CLI](/docs/reference/cli) for `setup`, `context`, and `login`.
