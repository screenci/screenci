# Signing In to Your App

Most products worth a demo video sit behind a login. ScreenCI's answer is the
one Playwright recommends: **sign in once, in a real browser, and reuse that
session.** You do it yourself on your own machine, so every method your product
supports works, including the ones a script could never handle.

#### You will learn

- [how to sign in once and record from it](#sign-in-once)
- [what to do when someone else is driving the terminal](#letting-an-agent-run-it)
- [where the session is kept, and what never happens to it](#where-the-session-lives)
- [how to record two roles in one project](#more-than-one-account)
- [what to do when the session expires](#when-a-session-expires)
- [how CI signs in, including with two-factor](#ci)

ScreenCI never stores a username, a password, or a one-time code. There is no
field to type them into and no place to keep them.

## Sign in once

From your `screenci/` workspace:

```bash
npx screenci login https://app.example.com
```

A browser window opens at that address with a small ScreenCI card floating near
the top left, and the command returns straight away. Sign in exactly the way you always do.
A password manager, an authenticator code, a company single sign-on redirect, a
passkey, a magic link in your email: all of it works, because it is a real
browser and you are the one using it.

When you are signed in and looking at your product, click **I'm signed in** on
the card. That saves the session and closes the window.

If a coding agent started the sign-in for you, it should be running
`npx screenci login --wait` while you do this, so your click reaches it. If it
told you to sign in and then went quiet without waiting, say "done" in the chat
and it will pick up from there: the session is already saved.

The card keeps clear of your product's own sign-in and account controls, and you
can drag it anywhere if it is still in the way; it stays where you put it for
the rest of the sign-in.

It only appears on your product's own pages. If signing in takes you to a
company single sign-on page or a provider's consent screen, it disappears until
you land back on your product: ScreenCI does not paint anything over someone
else's login form.

The address is optional when `use.baseURL` is set in `screenci.config.ts`:

```bash
npx screenci login
```

That is the whole setup. Recordings now start signed in, so your video scripts
contain no sign-in steps at all: no login form, no credentials, no `hide()`
block that types a password. They are also faster, since the sign-in no longer
runs before every video and every language.

## Letting an agent run it

When a coding agent is driving, it cannot click the banner for you, and you may
not have the terminal in front of you. So finishing has a second route:

```bash
npx screenci login          # the agent runs this; a browser opens
# you sign in
npx screenci login --done   # the agent runs this when you say you are done
```

Just tell the agent you have finished signing in. Either route saves the same
session, and running `--done` after you already clicked the banner simply
reports what was saved.

An agent should never ask you for a password or a code. If one does, that is
the wrong flow: it does not need them.

## Where the session lives

```
screenci/.screenci/auth/default.json        the session
screenci/.screenci/auth/default.meta.json   which site, when, until when
```

- It stays on your machine. Nothing uploads it, and ScreenCI holds no copy.
- It is written owner-readable only, and `.screenci/` is gitignored.
- Treat it like the password it replaces. Anyone holding the file is signed in
  as you. It also holds whatever cookies your identity provider set, which is
  what lets single sign-on carry over.
- `screenci.config.ts` finds it on its own. You only need `use.storageState` if
  you want to point at a different file.

Check on it any time:

```bash
npx screenci login --status
```

It prints which site it is for, how old it is, and when it expires. It never
prints anything from inside the file. To forget it:

```bash
npx screenci logout
```

## Recording a real account

The video shows whatever the account you signed in as can see: real customer
names, real invoice totals, real email addresses. Use a demo or test account
whenever the video will be shared. If you do record a real account, watch the
result before publishing it, and see [Redact](/docs/guides/redact) for hiding
individual elements.

## More than one account

A video that shows an admin view and a member view needs two sessions. Name
them:

```bash
npx screenci login --profile admin https://app.example.com
npx screenci login --profile member https://app.example.com
```

Then pick one for a run:

```bash
SCREENCI_AUTH_PROFILE=admin npx screenci preview "Admin dashboard"
```

Or point a video at one directly with Playwright's own option:

```ts
video.use({ storageState: '.screenci/auth/admin.json' })
```

## When it is not the session

A recording that stops on a challenge page ("Just a moment...", "Performing
security verification") is not a sign-in problem, even though it looks like
one. The site is rejecting the recorder's browser before it ever looks at your
session. See
[recording a site behind bot protection](/docs/reference/configuration#recording-a-site-behind-bot-protection).

## When a session expires

Sessions end when your product says they do. When that happens the recording
would quietly capture a login page instead of your app, so ScreenCI checks
before it records and says:

```
The saved session for https://app.example.com expired. Sign in again with
`npx screenci login`, or the recording will show a signed-out app.
```

Sign in again the same way. Nothing else changes, and `screenci login --status`
shows the new expiry.

Sessions are never renewed behind your back. Signing in is always something a
person does.

## CI

CI has nobody to open a browser for, so it needs a session handed to it. This
only comes up once your `screenci/` workspace lives in the repository and CI
records the videos. **Always use a dedicated test account, never a real
person's**, and see [CI Setup](/docs/ci-setup) for the workflow itself.

Two ways, both covered there:

- **Carry a saved session.** Put the contents of
  `screenci/.screenci/auth/default.json` in a repository secret and have the
  workflow write it back to a file. Simplest, but it expires and has to be
  refreshed by hand.
- **Sign in from a script in the repository.** A small Playwright script signs
  the CI test account in before the recording step and saves the session. It
  keeps working without anyone tending to it, and it can handle an
  authenticator code without a phone.

## What's next

- [CI Setup](/docs/ci-setup) for the workflow, the secrets, and the two-factor
  case.
- [AI Context](/docs/guides/ai-context) to tell agents up front that your site
  needs a sign-in.
- [CLI](/docs/reference/cli) for `login`, `logout`, and their options.
