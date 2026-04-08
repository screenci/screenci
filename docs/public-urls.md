---
title: Public URLs
description: Publish stable public video, thumbnail, and subtitle URLs that are served directly by the public delivery layer.
---

# Public URLs

ScreenCI can publish a stable public endpoint for a video. Once enabled, each selected language gets its own public URLs for:

- the rendered MP4 video
- the thumbnail image
- the WebVTT subtitle file, when available

These public assets are served directly by the public delivery layer from storage. ScreenCI only tracks which version is selected for each language. The media bytes do not pass through the application API layer.

## What gets published

When Public URL is enabled for a video, ScreenCI creates a stable base URL:

```text
https://api.screenci.com/public/<videoId>
```

For each published language, append one of these suffixes:

| Asset     | Path                                     |
| --------- | ---------------------------------------- |
| Video     | `/public/<videoId>/<language>/video`     |
| Thumbnail | `/public/<videoId>/<language>/thumbnail` |
| Subtitles | `/public/<videoId>/<language>/subtitle`  |

Example:

```text
https://api.screenci.com/public/video_123/en/video
https://api.screenci.com/public/video_123/en/thumbnail
https://api.screenci.com/public/video_123/en/subtitle
```

## How selection works

Public URLs always serve the currently published version for each language.

You can control that in two ways:

### Auto-select latest version

When enabled, every language automatically serves the newest finished render.

Use this when you want the public URL to update itself after each successful render.

### Manual selection

When auto-select is disabled, each language serves the version you explicitly select in the video page.

Use this when you want a review or approval step before the public output changes.

If a language has no selected version, that language will not be available on the public endpoint until you choose one.

## How to enable it in the app

1. Open a video in the ScreenCI app.
2. Go to the **Public URL** section.
3. Turn on **Enable public URL**.
4. Choose whether to use **Auto-select latest version** or manual selection.
5. For manual selection, choose the published version for each language in the language tables below.

Once enabled, the Public URL section shows:

- the stable base URL
- direct links to the documentation and API reference
- separate public URLs for video, thumbnail, and subtitles for every published language
- an example embed snippet

## Embedding a public video

Use the public thumbnail as the poster image and the subtitle URL as a `<track>` when available:

```html
<video
  controls
  crossorigin="anonymous"
  poster="https://api.screenci.com/public/YOUR_VIDEO_ID/en/thumbnail"
  style="max-width:100%"
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

If a language does not have subtitles yet, omit the `<track>` element.

## Caching behavior

Public assets are intended for embedding and repeated access.

- Metadata responses are cached briefly.
- Video, thumbnail, and subtitle responses are cacheable public assets.
- URLs remain stable while the selected version for that language can change behind the scenes.

That means you can keep the same public URL in docs, websites, or product pages while ScreenCI updates the selected version over time.

## Troubleshooting

### A language does not appear in the Public URL section

That language does not currently have a selected finished version.

- If auto-select is on, wait for a finished render.
- If auto-select is off, select a version manually.

### The video URL works but subtitles do not

That language version has no generated VTT file yet. The subtitle URL only exists when subtitles were created for the selected version.

### The thumbnail URL returns 404

That selected version does not have a published thumbnail, or the thumbnail asset is missing from storage.

### The public URL is enabled but old content is still showing

Public assets are cacheable. Allow a short time for caches to refresh after changing the selected version.

## Related docs

- [Public Video API](./public-api.md) for the endpoint-by-endpoint reference
- [Localization & Voiceovers](./localization.md) for multi-language render workflows
