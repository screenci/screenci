---
title: Public Video API
description: HTTP endpoints for accessing published videos, subtitles, and metadata without authentication.
---

# Public Video API

ScreenCI exposes a small set of unauthenticated HTTP endpoints for serving published videos. Once a video is published, these URLs can be embedded in websites, shared with users, or consumed by downstream tools.

All endpoints are served under `/public/:id/`.

---

## `GET /public/:id/metadata`

Returns the list of available language variants for a published video.

### Response

```json
{
  "languages": ["en", "de", "fr"]
}
```

### Error responses

| Status | Condition                                 |
| ------ | ----------------------------------------- |
| `404`  | The video ID has no public URL configured |

---

## `GET /public/:id/:language/video`

Serves the rendered MP4 file for a specific language variant.

### Query parameters

| Parameter  | Type     | Description                                                                                                |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `filename` | `string` | Filename used in the `Content-Disposition` header (default: `video.mp4`)                                   |
| `download` | `1`      | When set to `1`, adds `Content-Disposition: attachment` so the browser downloads instead of playing inline |

### Response headers

```
Content-Type: video/mp4
Content-Length: <bytes>
Accept-Ranges: bytes
```

### Error responses

| Status | Condition                                                                                                       |
| ------ | --------------------------------------------------------------------------------------------------------------- |
| `404`  | No public URL configured, or the requested language is not available, or the video file is missing from storage |

When the language is not found, the response includes the list of available languages:

```json
{
  "error": "Language not available: fr",
  "availableLanguages": ["en", "de"]
}
```

---

## `GET /public/:id/:language/subtitle`

Serves the WebVTT subtitle file for a specific language variant.

### Query parameters

| Parameter  | Type     | Description                                                                  |
| ---------- | -------- | ---------------------------------------------------------------------------- |
| `filename` | `string` | Filename used in the `Content-Disposition` header (default: `subtitles.vtt`) |
| `download` | `1`      | When set to `1`, adds `Content-Disposition: attachment`                      |

### Response headers

```
Content-Type: text/vtt
Content-Length: <bytes>
Access-Control-Allow-Origin: *
```

### Error responses

| Status | Condition                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------- |
| `404`  | No rendered version found, no subtitles for this version, or the VTT file is missing from storage |

---

## Example: embedding a video

Replace `YOUR_VIDEO_ID` with the ID of your published video.

```html
<video controls>
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

## Example: fetching available languages

```ts
const res = await fetch(
  'https://api.screenci.com/public/YOUR_VIDEO_ID/metadata'
)
const { languages } = await res.json()
// languages: ["en", "de"]
```
