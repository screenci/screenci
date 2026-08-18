# Anonymous Trial

`screenci edit` needs no account or `SCREENCI_SECRET` to try. Without one, a
recording uploads under a local, anonymous trial session: the CLI records the
live preview and prints the web editor link, and every edit you make in the
browser is written back into your script (live with `screenci edit --watch`,
otherwise queued and applied by the next `screenci` command). You sign up afterward to
keep the trial and export it. Recording an anonymous trial agrees to the
[Terms](https://screenci.com/legal/tos), which the CLI prints before it starts.

## What the trial includes

An anonymous trial is a full preview of ScreenCI's editing workflow:

- **Free live previews, uncapped.** `screenci edit` records and refreshes the
  live preview as often as you like for the trial's lifetime; nothing renders
  and nothing is billed.
- **The full web editor.** The editor is fully editable: narration, overlays,
  timeline cuts, camera, and render options, with every change written back
  into your `.screenci.ts` sources (live while a `screenci edit --watch`
  session is connected, otherwise on the next `screenci` command).
- **Expressive narration** (style prompts and tone control) in the preview.
- **Up to 3 narration languages at once** in a recording, a taste of the
  Business tier's unlimited languages.

## Trial limits

- **Preview-only.** The trial never renders or exports. Exporting the finished
  videos requires signing up and choosing a paid plan (Starter, Pro, or
  Business); `screenci export` without an account prints a sign-up link
  instead of recording.
- **Up to 3 videos and screenshots** per record run.
- **1080p maximum preview resolution.** 4K output requires the Business tier.
- **7 days.** An unclaimed trial expires (and its uploads are deleted) after
  seven days.

Each of these prints a specific reason when it is hit (which limit, and what to
do next), rather than a generic rejection.

## After you sign up

Signing in claims the trial into your account: its projects, videos, and
recordings become part of your organization. A running `screenci edit` session
upgrades itself automatically: the claim writes your `SCREENCI_SECRET` and a
personal `SCREENCI_EDIT_TOKEN` into `screenci/.env` and the session reconnects
with your account credentials without restarting.

With an active paid plan, `screenci export` (or the editor's Export button)
renders and downloads the finished videos.

## What's next

- [Editor](/docs/editor) for how browser edits sync back into your script.
- [Languages](/docs/guides/languages) to learn how multi-language rendering
  works once you are signed up.
- [Narration](/docs/guides/narration) for expressive voices, style prompts,
  and tone control.
- [CLI](/docs/reference/cli) for the full `edit` and `export` command
  reference.
