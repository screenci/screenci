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

An anonymous trial gives exactly one `screenci record` call, capped further
within that call:

- **One recording call.** Once a recording has uploaded (or the trial
  session expires), a second `screenci record` stops before it starts and
  prints a sign-up link instead of recording again.
- **Up to 3 videos and screenshots** in that one call.
- **Up to 3 narration languages at once**, combined across everything in the
  call.
- **1080p maximum resolution.** 4K output requires signing up for the
  Business tier.

Each of these prints a specific reason when it is hit (which limit, and what
to do next), rather than a generic rejection.

## After you sign up

Signing in claims the trial into your account: its projects, videos, and
versions become part of your organization. New accounts start on the Free
plan automatically, with the same one-language limit as Starter.

If you then choose the **Starter** plan (not Business) and the trial used
expressive narration or more than one language, those specific videos do not
get the automatic watermark-free re-render that a paid upgrade normally
triggers: Starter does not include those features, so leaving the trial
watermark in place is the correct behavior rather than silently rendering
content Starter does not allow. The app lists exactly which videos are
affected and why, with a link to upgrade to Business, where every trial
feature keeps working and those videos render without a watermark.

## What's next

- [Languages](/docs/guides/languages) to learn how multi-language rendering
  works once you are signed up.
- [Narration](/docs/guides/narration) for expressive voices, style prompts,
  and tone control.
- [CLI](/docs/reference/cli) for the full `record` command reference.
