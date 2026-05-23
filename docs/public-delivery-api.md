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
