# Hosted Recording (Internal Testing)

Hosted recording records a video on ScreenCI's own machines from the files
ScreenCI stores for it, so a teammate can record or re-record without a
repository, a coding agent, or a pipeline. It is in internal testing: it is
switched on per organisation by ScreenCI, and nothing changes for
organisations that do not use it.

#### You will learn

- [how a hosted run works](#how-a-hosted-run-works)
- [which videos can run hosted](#which-videos-can-run-hosted)
- [environment variables and secrets](#environment-variables-and-secrets)
- [signing in to your app](#signing-in-to-your-app)
- [network settings](#network-settings)
- [limits](#limits)

## How a hosted run works

A run starts from the app (**Record now**, or **Record flagged videos now**
on the project), from the project's schedule, or from a connected AI
assistant. For each video:

1. A fresh, isolated machine fetches the video's stored files (see
   [Project files and layout](/docs/guides/project-files)): the root files,
   `recordings/shared/`, the script, and the video's own folder.
2. It writes them into an empty workspace, writes the env file the config
   names (`.env` by default) with the project's environment variables, and
   installs the dependencies (with the lockfile frozen when one is stored).
3. It runs `screenci preview` for exactly that video (selected by its
   exact title, so "Intro" never also records "Product Intro").

One 15 minute limit covers the whole run: fetching the files, installing,
and recording. A run that reaches it is stopped and reported as failed. 4. It reports the result, which the run's results page shows. The recording
lands in the project's CI preview, like a pipeline run.

Each run gets a single-use token and a short-lived upload key for its own
project. The token is kept out of the environment of the install and of
the recording; it only lets the run report its own status, and the minutes
are measured by ScreenCI itself.

## Which videos can run hosted

Only videos whose script follows the project layout: one video per
`recordings/<name>.screenci.ts`. Record the video once with `screenci
preview` (or from CI) so ScreenCI stores its files, then flag it for hosted
recording on its page.

## Environment variables and secrets

A hosted run has no `.env` of yours. The project's environment variables,
set in the project settings, take its place:

- Only organisation members with the **developer** or **admin** role can add,
  change, or delete them. Every member can see their names.
- Values are **write-only**: no page, API, or connected assistant ever shows
  a value again. Hosted runs receive them in their env file; the page
  snapshot a connected assistant can take receives only the values the
  network settings name and `SCREENCI_APP_STORAGE_STATE_JSON`.
- During internal testing the values are encrypted in ScreenCI's database;
  they are not kept in a dedicated secrets vault. Use test accounts and
  scoped tokens, not production credentials.
- Names use capital letters, digits, and underscores (`MY_TOKEN`). The run
  sets `SCREENCI_SECRET`, `SCREENCI_API_URL`, and `SCREENCI_APP_URL` (the
  project's site) itself; a variable with one of those names is ignored.

Scripts read them with `process.env`, exactly as they read your local `.env`,
so the same script works on your machine and hosted.

## Signing in to your app

Hosted runs cannot use the browser sign-in of `screenci login`. A script
that must sign in reads these conventional variables and signs in itself,
inside `hide()` so the login never appears in the video:

```ts
import { hide, video } from 'screenci'

video('Add a lead', async ({ page }) => {
  await hide(async () => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(process.env.SCREENCI_LOGIN_USERNAME!)
    await page.getByLabel('Password').fill(process.env.SCREENCI_LOGIN_PASSWORD!)
    await page.getByRole('button', { name: 'Sign in' }).click()
  })
  // ...
})
```

| Variable                          | Meaning                                                    |
| --------------------------------- | ---------------------------------------------------------- |
| `SCREENCI_LOGIN_USERNAME`         | Test account the script signs in with                      |
| `SCREENCI_LOGIN_PASSWORD`         | Its password                                               |
| `SCREENCI_APP_STORAGE_STATE_JSON` | A saved signed-in session (Playwright storage state, JSON) |

Locally, put the same names in the workspace `.env` (never committed, never
uploaded) so the script runs unchanged. Accounts with two-factor or single
sign-on cannot sign in from a script; use a test account without them.

## Network settings

A site behind a proxy, HTTP basic auth, or a bypass header is reachable with
the network settings in the project settings (developers only). They refer to
environment variables by name, so the values stay write-only. A developer
also approves one **credential origin** (for example
`https://staging.example.com`): the HTTP credentials and extra headers are
sent to that origin only, never to other sites the page loads. The run turns
the settings into these variables, which the CLI applies to the browser
context (values set in `screenci.config.ts` win):

| Variable                             | Applied as                                                 |
| ------------------------------------ | ---------------------------------------------------------- |
| `SCREENCI_PROXY_SERVER`              | `proxy.server`, for example `http://proxy:3128`            |
| `SCREENCI_PROXY_USERNAME`            | `proxy.username`                                           |
| `SCREENCI_PROXY_PASSWORD`            | `proxy.password`                                           |
| `SCREENCI_HTTP_CREDENTIALS_USERNAME` | `httpCredentials.username` (HTTP basic auth)               |
| `SCREENCI_HTTP_CREDENTIALS_PASSWORD` | `httpCredentials.password`                                 |
| `SCREENCI_EXTRA_HEADERS_JSON`        | Extra request headers, a JSON object `{"X-Name": "value"}` |
| `SCREENCI_CREDENTIAL_ORIGIN`         | The only origin the credentials and headers go to          |

With `SCREENCI_CREDENTIAL_ORIGIN` set, the credentials answer only that
origin's sign-in challenge and the headers are added only to requests for
that origin (a route the script adds itself and that sends a request on
with `route.continue()` skips them). Without it, the credentials and headers
apply to every request, like Playwright's own `httpCredentials` and
`extraHTTPHeaders`. The proxy always applies to every request.

The CLI reads these variables on every machine, so a developer can put them
in the local `.env` and record exactly the way a hosted run does.

## Limits

- One run records one video and stops after 15 minutes, including the
  install.
- Each organisation has a daily run cap and a limit on runs at the same
  time; a scheduled run is skipped when the video's files have not changed
  since its last finished run.
- Hosted recording minutes are tracked on the billing page and are not
  billed during internal testing.
- The site must be reachable from the public internet.

## Related pages

- [Project files and layout](/docs/guides/project-files)
- [`screenci ci`](/docs/screenci-ci) to record flagged videos from your own pipeline.
- [Signing in to your app](/docs/guides/signing-in) for local and CI sign-in.
