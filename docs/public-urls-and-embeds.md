# Public URLs and Embeds

Public URLs give a ScreenCI video a stable delivery surface outside the app. Once enabled, each selected language gets its own video, thumbnail, and subtitle URL that you can embed in docs, changelogs, support articles, or product pages.

#### You will learn

- [what public URLs are](#what-public-urls-look-like)
- [how language-specific outputs behave](#latest-vs-selected-output)
- [where to use them](#good-use-cases)
- [how they relate to the public delivery API](#whats-next)

## What public URLs look like

Public delivery starts from a stable base:

```text
https://api.screenci.com/public/<videoId>
```

Then each published language exposes:

- `/public/<videoId>/<language>/video`
- `/public/<videoId>/<language>/thumbnail`
- `/public/<videoId>/<language>/subtitle`

## Latest vs selected output

Public delivery can either:

- follow the latest finished render automatically
- stay pinned to the selected accepted version for each language

That lets you choose between automatic freshness and manual editorial control.

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
