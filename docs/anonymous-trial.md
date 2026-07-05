# Anonymous Trial

`screenci record` needs no account or `SCREENCI_SECRET` to try. Without one, a
recording uploads under a local, anonymous trial session: the CLI prints a link
to view the result, and you sign up afterward to keep it. Recording an
anonymous trial agrees to the [Terms](https://screenci.com/legal/tos), which
`record` prints before it starts.

## What the trial includes

An anonymous trial gets a full preview of ScreenCI, including two Business-tier
narration features, so you can judge the best of what a paid plan unlocks
before creating an account:

- **Expressive narration** (style prompts and tone control) is allowed
  outright.
- **Multiple narration languages**: up to 3 languages at once, well above the
  single-language limit that Free and Starter carry after signup (see
  [One language per plan](/docs/guides/languages#one-language-per-plan)), but
  short of Business's unlimited languages.

Every trial render carries a ScreenCI watermark, the same as any render on an
account without an active paid plan.

## Trial limits

An anonymous trial gives up to three `screenci record` calls, each capped
further within that call:

- **Three recording calls.** You can run `screenci record` up to three times on
  the trial. After each successful call the CLI prints how many recordings are
  left. Once all three are used (or the trial session expires), a further
  `screenci record` stops before it starts and prints a sign-up link instead of
  recording again.
- **Up to 3 videos and screenshots** in each call.
- **Up to 3 narration languages at once**, combined across everything in a
  call.
- **1080p maximum resolution.** 4K output requires signing up for the
  Business tier.

Each of these prints a specific reason when it is hit (which limit, and what
to do next), rather than a generic rejection.

## After you sign up

Signing in claims the trial into your account: its projects, videos, and
versions become part of your organization. New accounts start on the Free
plan automatically, with the same one-language limit as Starter.

Renders you make on a paid plan after signing up are watermark free. Renders
that were made during the trial keep their watermark: upgrading does not
automatically re-render existing trial videos. Re-record (or re-render) a video
on your paid plan whenever you want a watermark-free version of it.

## What's next

- [Languages](/docs/guides/languages) to learn how multi-language rendering
  works once you are signed up.
- [Narration](/docs/guides/narration) for expressive voices, style prompts,
  and tone control.
- [CLI](/docs/reference/cli) for the full `record` command reference.
