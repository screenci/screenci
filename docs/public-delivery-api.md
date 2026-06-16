# Public Delivery API

The public delivery API is the narrow technical surface for published ScreenCI media. It is unauthenticated and meant for stable consumption from websites, docs systems, and other embedding clients.

## Endpoint families

All public routes live under:

```text
/public/:id
```

## `GET /public/:id/metadata`

Returns the list of currently available languages for the published video.

Example response:

```json
{
  "languages": ["en", "de", "fi"]
}
```

Error responses:

| Status | Condition                                 |
| ------ | ----------------------------------------- |
| `404`  | The video ID has no public URL configured |

## `GET /public/:id/:language/video`

Serves the rendered MP4 for one language variant.

Useful query parameters:

- `filename`
- `download=1`
- `record=<recordId>` (see [Record-pinned URLs](#record-pinned-urls))

Response headers:

```text
Content-Type: video/mp4
Content-Length: <bytes>
Accept-Ranges: bytes
Access-Control-Allow-Origin: *
```

Error responses:

| Status | Condition                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| `404`  | No public URL configured, the requested language is not available, or the video file is missing from storage |

When the language is not available, the response can include the languages that do exist:

```json
{
  "error": "Language not available: fr",
  "availableLanguages": ["en", "de"]
}
```

## `GET /public/:id/:language/thumbnail`

Serves the published thumbnail image for one language variant.

Useful query parameters:

- `filename`
- `download=1`
- `record=<recordId>` (see [Record-pinned URLs](#record-pinned-urls))

Response headers:

```text
Content-Type: image/jpeg
Content-Length: <bytes>
Access-Control-Allow-Origin: *
```

Error responses:

| Status | Condition                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------- |
| `404`  | No public URL configured, the requested language is not available, or the thumbnail is missing |

## `GET /public/:id/:language/subtitle`

Serves the WebVTT subtitle file for one language variant when subtitles exist for the selected render.

Useful query parameters:

- `filename`
- `download=1`
- `record=<recordId>` (see [Record-pinned URLs](#record-pinned-urls))

Response headers:

```text
Content-Type: text/vtt
Content-Length: <bytes>
Access-Control-Allow-Origin: *
```

Error responses:

| Status | Condition                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------- |
| `404`  | No rendered version found, no subtitles for this version, or the VTT file is missing from storage |

## Record-pinned URLs

Every media endpoint accepts an optional `record=<recordId>` query parameter.
Without it, the route serves the **currently selected** version (the stable,
"static" URL). With it, the route serves the render produced by that specific
`screenci record` run.

```text
GET /public/:id/:language/video                    # latest selected version
GET /public/:id/:language/video?record=<recordId>  # this run's render
```

This record-pinned surface is enabled by the same single public switch as the
static URLs (no separate setting). The CLI surfaces it per language as
`latestRecord` in [`screenci info`](/docs/reference/cli#screenci-info).

### Fallback logic

Renders do not live forever. ScreenCI keeps only a bounded number of versions
per video and cleans up older ones, so a record-pinned URL must keep working
after the exact render it points at is gone:

1. **Public gate.** If the video has no public delivery configured, the request
   `404`s immediately, with or without `?record=`. Making a video private takes
   every URL (static and pinned) offline at once.
2. **Pinned render.** With `?record=<recordId>`, if that run's render for the
   requested language still exists, it is served exactly.
3. **Fallback to selected.** If that run's render has been cleaned up (or the
   run never produced one for this language), the request transparently falls
   back to the currently selected version, the same bytes the static URL would
   return. The response still succeeds; it just serves the newest selection.
4. **Asset-level fallback.** Thumbnails and subtitles fall back independently of
   the video: if this run's render had no subtitle, the subtitle URL falls back
   to the selected version's subtitle (and `404`s only if none exists at all).

In short: a record-pinned URL serves the exact run while it lives, then the
newest selected version, and `404`s only when the video is not public (or the
language was never published).

Each video keeps only a bounded number of its own versions, so older runs of the
same video are eventually cleaned up no matter what. If you need many record
runs to stay individually addressable forever, record them as **separate
videos** rather than as repeated runs of one video: every video has its own
version budget, so adding more videos is how you keep more renders alive at once.

The `recordId` for the most recent run, along with both URL sets, is printed by
[`screenci info`](/docs/reference/cli#screenci-info).

## Response behavior

These routes are designed for embedding:

- CORS-friendly
- stable URLs
- language-specific outputs
- 404 when the requested language or asset is not publicly available

All media endpoints are served with `Access-Control-Allow-Origin: *`, so they can be embedded from other origins without credentials.

## Example embed

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

## Example metadata fetch

```ts
const res = await fetch(
  'https://api.screenci.com/public/YOUR_VIDEO_ID/metadata'
)
const { languages } = await res.json()
```

## Relation to the guide

Use [Public URLs and Embeds](/docs/guides/public-urls-and-embeds) for the workflow, publishing model, and embed examples. Use this page when you want the route patterns and response expectations directly.
