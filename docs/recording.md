---
title: Recording Flows
description: How to write ScreenCI video scripts — from a blank file to a polished recording with cues, zoom, and hidden setup steps.
---

ScreenCI turns Playwright scripts into product videos. If you've written a Playwright test before, you already know most of what you need.

---

## Quick start

### 1. Install

```bash
npm install screenci
```

### 2. Init a project

```bash
npx screenci init my-project
cd my-project
npm install
```

This creates:

```
my-project/
  screenci.config.ts     ← recording settings
  videos/
    example.video.ts     ← starter script
  Dockerfile             ← for CI recording in a container
  .gitignore
  package.json
```

### 3. Write a video script

Video scripts are plain `.video.ts` files. Each `video()` call produces one recording:

```ts
// videos/onboarding.video.ts
import { video } from 'screenci'

video('Onboarding flow', async ({ page }) => {
  await page.goto('https://app.example.com/signup')
  await page.fill('input[name="name"]', 'Jane Doe')
  await page.fill('input[name="email"]', 'jane@example.com')
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard')
})
```

That's Playwright. screenci extends it — it does not replace it.

### 4. Develop without recording

```bash
npm run dev
# or: npx screenci dev
```

Opens the Playwright UI. Run your scripts, verify they work, fix selectors — no screen capture, no container, no FFmpeg. Just normal Playwright test execution.

### 5. Record

```bash
cd my-project && npm run record
# or: npx screenci record
```

Launches a headless browser in a virtual display, runs FFmpeg to capture the screen, and saves:

```
.screenci/
  onboarding-flow/
    recording.mp4
    data.json
```

---

## What ScreenCI adds

Everything in [Playwright's `page` API](https://playwright.dev/docs/api/class-page) works unchanged. On top of that, screenci gives you:

| Feature               | What it does                                                        |
| --------------------- | ------------------------------------------------------------------- |
| Animated cursor paths | Clicks arrive with a smooth bezier curve instead of teleporting     |
| Typed character input | `fill()` types character-by-character so the viewer sees keystrokes |
| `hide(fn)`            | Cuts a section from the final video (logins, page loads, setup)     |
| `autoZoom(fn)`        | Smooth camera pan that follows interactions inside the callback     |
| `createNarration()`   | Typed narration markers you `await` where each spoken line starts   |
| `createAssets()`      | Image or video overlays shown during the recording                  |

These are composable. You can combine `hide`, `autoZoom`, and cues around any Playwright code.

---

## A complete example

```ts
import { video, hide, autoZoom, createNarration, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Aria },
  languages: {
    en: {
      cues: {
        openForm: "Let's add a new team member.",
        submit: "One click and they're in.",
      },
    },
  },
})

video('Invite a team member', async ({ page }) => {
  // Login happens off-screen — viewer jumps straight to the app
  await hide(async () => {
    await page.goto('/login')
    await page.fill('input[type="email"]', 'admin@example.com')
    await page.fill('input[type="password"]', 'secret')
    await page.click('[type="submit"]')
    await page.waitForURL('**/dashboard')
  })

  // Start narration where that line should begin.
  await narration.openForm
  await autoZoom(
    async () => {
      await page.locator('#invite').click()
      await page.locator('input[name="email"]').fill('newperson@example.com')
    },
    { duration: 400, easing: 'ease-in-out', amount: 0.4 }
  )

  // Starting the next narration segment automatically ends the previous one.
  await narration.submit
  await narration.wait()
  await autoZoom(
    async () => {
      await page.locator('button[type="submit"]').click()
      await page.waitForTimeout(500)
    },
    { duration: 400, easing: 'ease-in-out', amount: 0.4 }
  )
})
```

The key timing rule is simple: `await narration.key` starts audio immediately and your script keeps moving. Only call `await narration.wait()` when the next action must happen after the spoken line finishes.

---

## Tips

### Hide navigation at the start

The very first thing your video does is almost always a `page.goto()`. Wrap it in `hide()` so the video jumps straight into the live, ready UI:

```ts
video('CRM demo', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://app.example.com/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
  })

  // Viewer sees the app fully loaded
  await page.locator('#new-deal').click()
})
```

### Hide navigation between sections too

Use `hide()` between page transitions as well — viewers don't need to watch a loading spinner:

```ts
// ... previous section ...

await hide(async () => {
  await page.locator('nav a[href="/reports"]').click()
  await page.waitForURL('**/reports')
})

await autoZoom(
  async () => {
    // interact with the reports page
  },
  { duration: 400, easing: 'ease-in-out', amount: 0.4 }
)
```

### One `autoZoom` per page section

Wrap a full form or page section in one `autoZoom`, not one per click. The camera zooms in when you arrive and zooms back out when you leave — a single, smooth motion rather than a series of jolts.

### Test titles become filenames

`video('My Feature Demo')` outputs to `.screenci/my-feature-demo/`. Keep titles unique within a project after kebab-case normalization.

---

## Other recording methods

### Browser extension

For non-technical team members who want to record without writing scripts. Point and click through a flow and the extension writes the `.video.ts` file for you.

### MCP server

Use the screenci MCP server with AI editors (Cursor, Claude Desktop, etc.) to generate or edit video scripts with natural language. Ask your assistant to "update the recording to use the new button label" and it handles the script surgery.
