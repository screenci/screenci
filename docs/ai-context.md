# AI Context

Coding agents make the best videos when they know where your product's code
lives, where it runs, whether they may start it, and how to sign in. The
**AI context** page in the web app (top-right menu) stores that once for the
whole organisation, so nobody has to type it into every prompt. Projects can
override each field, and every member keeps a personal, encrypted login for the
site. `screenci start` reads it all when an agent runs a setup prompt.

#### You will learn

- [what the four fields mean](#the-fields)
- [how a project overrides the organisation](#project-overrides)
- [what the agent does with the repository](#the-repository)
- [what happens when the site is not running](#running-the-app-locally)
- [how personal site logins reach the agent](#your-login-for-the-site)
- [what each version records about the site it ran against](#site-metadata)
- [moving service-managed sources into the repository](#move-to-repository)

## The fields

| Field                           | What the agent does with it                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repository URL**              | Reads the product's routes, components, and README for real URLs and selectors. Clones it when the prompt runs outside the repository. Use a URL without credentials.  |
| **Site URL**                    | The address to record: a deployed site, or a `localhost` address for a dev server. Prefills the App URL field of every prompt dialog.                                  |
| **Let the agent start the app** | Off by default. When a localhost site does not answer, the agent stops and reports. On, the agent reads the repository, starts the dev server, and records.            |
| **Notes for the agent**         | Free text, up to 4000 characters: how to run the app, which demo workspace to use, flows to avoid, vocabulary. Printed to the agent verbatim as "Notes from the team". |

Any member can edit the organisation values. The agent can re-read them at any
time with [`screenci context`](/docs/reference/cli#screenci-context).

## Project overrides

The **AI context** button on a project page opens the same form with an
**Override for this project** toggle per field. A field without the toggle
inherits the organisation value (shown as its placeholder). The project's
site URL override is the same value the prompt dialogs remember as the app
URL.

A repository URL typed into an Add project, Add video, Edit, or Move to
repository dialog is stored on that project as an override, so the field only
appears while no repository is known.

## The repository

When the agent runs `screenci start`:

1. If the current folder is inside a git repository whose `origin` is the
   configured repository URL (any scheme or case), that checkout is used.
2. Otherwise the repository is cloned shallowly into `.screenci/repo` next to
   the workspace (a `.screenci/.gitignore` keeps it out of the current
   repository). An existing clone is fast-forwarded.
3. A `screenci/` folder with a `screenci.config.ts` inside the repository is
   used as the workspace. Without one, the project's sources come from
   ScreenCI into `./screenci` as before (service-managed projects), or the
   command stops with "source missing" (repository-managed projects).

A clone that fails (no access from the agent's machine) is reported in the
brief; the agent continues from the site alone when the site answers. Pass
`--no-clone` to skip cloning.

Repository-managed projects with a known repository URL get the **Add video**
and **Edit** buttons too: the agent commits its change on a branch and pushes
it, since the sources live in git.

## Running the app locally

`start` probes the site URL (the prompt's App URL, else the AI context's site
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

## Your login for the site

Videos that need to sign in read `process.env.APP_USERNAME` and
`process.env.APP_PASSWORD` inside `hide()`. Each member saves their own
username and password on the AI context page ("Your login for the site"). It
is stored encrypted, it is never shown again in the app, and it never appears
in a prompt or in agent output.

- `screenci start` fetches the login of the person who created the setup code
  (through their personal editor token) and writes both variables into the
  workspace env file. Values a person typed by hand are kept.
- Without a saved login the env file gets empty placeholders, and the brief
  tells the agent to ask the person to save theirs and then run
  [`screenci pull-login`](/docs/reference/cli#screenci-pull-login), or to paste
  the values into the env file directly.
- Use a demo or test account, never a personal one with real data; the videos
  show whatever that account sees.
- CI does not have a personal login: set `APP_USERNAME` and `APP_PASSWORD` as
  CI secrets (see [CI Setup](/docs/ci-setup)).

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

## Move to repository

A project created from the web app keeps its scripts in ScreenCI
(service-managed). **Move to repository** on the project page produces a prompt
that has the agent commit those scripts into the product repository:

1. `screenci start` with the code locates the repository (or clones it), pulls
   the project's latest sources into `screenci/` inside it, removes `projectId`
   from `screenci.config.ts`, and records which source bundle it pulled.
2. The agent commits on a branch, pushes, opens a pull request, and runs a
   `preview` from the repository copy.
3. `screenci merge-complete --pr <url>` reports the commit. ScreenCI marks the
   project as repository-managed, and every version recorded from those
   sources shows an **In repository** badge with the commit.

From then on Add video and Edit clone or use the repository instead of pulling
sources from ScreenCI.

## What's next

- [Create Videos from the Web App](/docs/guides/create-from-web-app) for the
  prompt flow itself.
- [CLI](/docs/reference/cli) for `start`, `context`, `pull-login`, and
  `merge-complete`.
