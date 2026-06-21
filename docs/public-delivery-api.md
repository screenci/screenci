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

Serves the rendered MP4 for one language variant. This is the stable static URL,
which follows the currently selected version. To pin to a specific run, use the
[record-pinned URL](#record-pinned-urls) form instead.

Useful query parameters:

- `filename`
- `download=1`

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

Serves the published thumbnail image for one language variant. Follows the
currently selected version; pin to a run with the
[record-pinned URL](#record-pinned-urls) form.

Useful query parameters:

- `filename`
- `download=1`

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

Serves the WebVTT subtitle file for one language variant when subtitles exist for the selected render. Follows the
currently selected version; pin to a run with the
[record-pinned URL](#record-pinned-urls) form.

Useful query parameters:

- `filename`
- `download=1`

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

## `GET /public/:id/:language/screenshot`

Serves the published screenshot image for one language variant. A version is
either a video or a screenshot, never both: this route only serves versions
recorded as screenshots, and `/video` only serves video versions. Follows the
currently selected version; pin to a run with the
[record-pinned URL](#record-pinned-urls) form.

Useful query parameters:

- `filename`
- `download=1`

Response headers:

```text
Content-Type: image/png
Content-Length: <bytes>
Access-Control-Allow-Origin: *
```

The `Content-Type` is `image/png`, or `image/jpeg` when the stored screenshot is
a JPEG.

Error responses:

| Status | Condition                                                                                                                                           |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `404`  | No public URL configured, the requested language is not available, the selected version is a video (not a screenshot), or the screenshot is missing |

## Record-pinned URLs

Every media endpoint has a record-pinned form that adds a `records/<recordId>`
segment to the path. The static URL (no `records/` segment) serves the
**currently selected** version. The pinned URL serves the render produced by that
specific `screenci record` run.

```text
GET /public/:id/:language/video                       # latest selected version
GET /public/:id/records/<recordId>/:language/video    # this run's render
```

The same shape applies to `thumbnail`, `subtitle`, and `screenshot`. Because a pinned URL is
immutable, it is served with a long, `immutable` `Cache-Control`, while the
static URL uses a short TTL so it can follow the selected version.

This record-pinned surface is enabled by the same single public switch as the
static URLs (no separate setting). The CLI surfaces it per language as
`latestRecord` in [`screenci info`](/docs/reference/cli#screenci-info).

### Resolution rules

A record-pinned URL is an **immutable** contract: it serves that exact run's
render, or it `404`s. It never silently swaps to a different video.

1. **Public gate.** If the video has no public delivery configured, the request
   `404`s immediately, for both the static and pinned URLs. Making a video
   private takes every URL (static and pinned) offline at once.
2. **Pinned render.** With `records/<recordId>` in the path, if that run's render
   for the requested language still exists, it is served exactly.
3. **404 once cleaned up.** If that run's render has been pruned (or the run
   never produced one for this language), the pinned URL `404`s. It does **not**
   fall back to the currently selected version, because doing so could serve a
   different video than the one you embedded.
4. **Asset-level.** Each asset is pinned to the same run: if this run produced no
   subtitle, the pinned subtitle URL `404`s rather than borrowing the selected
   version's subtitle.

The stable `static` URL (no `?record=`) always follows the currently selected
version, which always exists, so use it whenever you just want "the latest."

### Version retention

Renders do not live forever. ScreenCI keeps the currently selected version plus
a bounded number of recent versions per language, then prunes the rest. The
budget depends on your plan:

| Plan     | Versions kept per language |
| -------- | -------------------------- |
| Free     | 3                          |
| Starter  | 5                          |
| Business | 50                         |

Once a run is pruned, its record-pinned URLs `404` (see above).

### Keep a render forever

To archive a specific run permanently, download its files right after recording,
before they can be pruned, using the authenticated download URLs printed by
[`screenci info`](/docs/reference/cli#screenci-info). These require your
`X-ScreenCI-Secret` header, so they are private (not embeddable), and they let
you keep the exact bytes in your own storage without growing your ScreenCI
version budget:

```bash
curl -H "X-ScreenCI-Secret: $SCREENCI_SECRET" \
  "https://api.screenci.com/cli/download/YOUR_VIDEO_ID/en/video?record=YOUR_RECORD_ID" \
  -o video.mp4
```

The `recordId` for the most recent run, along with the public and download URL
sets, is printed by [`screenci info`](/docs/reference/cli#screenci-info).

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
