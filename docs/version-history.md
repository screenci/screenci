# Version History

Every time a video (or screenshot) is rendered, ScreenCI keeps the result as a
**version**. One version is always the **selected** one: it is what a public URL
serves and what embeds display. Version history lets you keep older renders
around, compare them, and roll back by selecting a previous one, without
re-recording.

> Every plan keeps the 5 most recent non-selected versions per language (plus the
> selected one), so you always have a recent history to compare against and roll
> back to.

#### You will learn

- [what a version is](#what-a-version-is)
- [how selection works](#selecting-a-version)
- [how many versions are kept](#retention)

## What a version is

A version is one finished render of a video: the encoded media, its thumbnail,
and the exact render options, narration, and overlays used to produce it. Because
each render is preserved, you can change something in Editor, render again, and
still fall back to the previous look if you prefer it.

Versions are tracked **per language**: an English render and a German render of
the same video each have their own independent history.

## Selecting a version

The **selected** version is the one served at the video's
[public URL](/docs/guides/public-urls-and-embeds) and shown in embeds. Pick which
render to serve with the **Select** button in the Versions list, or enable
**Auto-select latest** so the newest finished render is always served
automatically. Selecting an older version is an instant rollback: no
re-recording, no re-rendering.

## Retention

Every plan keeps the 5 most recent non-selected versions per language so you
always have a recent history to compare against and roll back to. When that count
is exceeded, the oldest non-selected versions are pruned first; the selected
version is never pruned.

Newly rendered versions have a short grace period (about an hour) during which
they are never pruned, even beyond the kept count, so a burst of quick
re-renders is not deleted out from under you. Once they age past the grace
period they are swept automatically back down to the kept count. To keep a
render forever, download it via the authenticated `screenci info` download URLs.
