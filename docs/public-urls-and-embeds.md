# Public URLs and Embeds

Public URLs give a ScreenCI video a stable delivery surface outside the app. Once enabled, each selected language gets its own video, thumbnail, and subtitle URL that you can embed in docs, changelogs, support articles, or product pages.

#### You will learn

- [what public URLs are](#what-public-urls-look-like)
- [how language-specific outputs behave](#latest-vs-selected-output)
- [how to make a video public in the app](#enable-public-delivery-in-the-app)
- [how selection works per language](#how-selection-works)
- [where to use them](#good-use-cases)
- [how they relate to the public delivery API](#whats-next)

<!-- screenci-doc-video:docs/guides/public-urls-and-embeds -->

## What public URLs look like

Public delivery starts from a stable base:

```text
https://api.screenci.com/public/<videoId>
```

Then each published language exposes:

- `/public/<videoId>/<language>/video`
- `/public/<videoId>/<language>/thumbnail`
- `/public/<videoId>/<language>/subtitle`

The thumbnail comes in three downscaled sizes. Add `?size=sm` (small previews),
`?size=md` (poster, the default), or `?size=lg` (full-screen / downloads). See
the [public delivery API](/docs/reference/public-delivery-api#get-publicidlanguagethumbnail)
for exact dimensions.

## Latest vs selected output

Public delivery can either:

- follow the latest finished render automatically
- stay pinned to the selected accepted version for each language

That lets you choose between automatic freshness and manual editorial control.

When a video is made public, ScreenCI starts in automatic mode. The latest
finished render for each language becomes the active public output right away.

## Enable public delivery in the app

Open the video in the ScreenCI app and turn on **Enable public URL**.

That does three things:

1. creates a stable public route for the video
2. turns on **Auto-select latest version**
3. selects the newest finished render for each existing language

From there you have two ways to operate:

- keep **Auto-select latest version** enabled if each new finished render should
  replace the currently served one automatically
- turn **Auto-select latest version** off if you want to review versions and
  manually pin one per language

## How selection works

Public delivery is tracked separately for each language.

- each language has its own current selected version
- only finished renders with an actual video output can be selected
- failed, still-rendering, or deleted versions are never served publicly

When **Auto-select latest version** is on, ScreenCI keeps moving each language
forward to the latest finished render.

When **Auto-select latest version** is off, you must select a version manually
for each language you want to serve. If a language has no selected version, its
public URL exists but that language will not resolve to a video until you pick
one.

Manual selection is currently done in the app, not the CLI.

## Per-run (record-pinned) URLs

Alongside the stable URLs above, every media URL has a record-pinned form that
adds a `records/<recordId>` segment to the path, pinning it to a specific
`screenci record` run:

```text
https://api.screenci.com/public/<videoId>/records/<recordId>/<language>/video
```

The same single **Enable public URL** switch turns on both the stable URLs and
these record-pinned ones. A record-pinned URL is immutable: it serves that run's
own render, or `404`s once the run is cleaned up. It never falls back to a
different version, and it always honors the public switch, so it also `404`s if
the video is made private.

ScreenCI keeps only a bounded number of versions per language (the 5 most recent
non-selected versions on every plan), so older runs are eventually pruned. To keep a specific
run forever, download it via the authenticated URLs in
[`screenci info`](/docs/reference/cli#screenci-info), described under
[Keep a render forever](/docs/reference/public-delivery-api#keep-a-render-forever).

Use the stable URL when you always want the newest published render, and the
record-pinned URL when you want to reference exactly the run a given CI build
produced. The [`screenci info`](/docs/reference/cli#screenci-info) command prints
both URL sets (as `static` and `latestRecord`) when run on a machine that made
the record.

## Typical embed

```html
<video
  controls
  crossorigin="anonymous"
  poster="https://api.screenci.com/public/YOUR_VIDEO_ID/en/thumbnail"
>
  <source
    src="https://api.screenci.com/public/YOUR_VIDEO_ID/en/video"
    type="video/mp4"
  />
  <track
    kind="subtitles"
    src="https://api.screenci.com/public/YOUR_VIDEO_ID/en/subtitle"
    srclang="en"
    label="English"
    default
  />
</video>
```

## Good use cases

- product documentation
- changelog posts
- support content
- release landing pages

## Privacy and stability

Only enable public URLs for videos that are meant to be accessible publicly. Once enabled, the route is stable by design, even though the selected underlying render can change later.

## What's next

- [Public Delivery API](/docs/reference/public-delivery-api) for endpoint-level
  details.
- [CLI](/docs/reference/cli) for `screenci info`, `make-public`, and
  `make-private`.
