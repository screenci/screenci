import { expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  autoZoom,
  createOverlays,
  hide,
  resetZoom,
  video,
  voices,
  zoomTo,
} from 'screenci'

// Before recording:
//   1. Put the condensed, cursor-safe agent capture at assets/agent.mp4.
//   2. Set SCREENCI_APP_STORAGE_STATE to a logged-in Playwright storage state.
//   3. Override these defaults when the agent created a different remote video:
//        SCREENCI_PITCH_PROJECT_NAME
//        SCREENCI_PITCH_VIDEO_NAME
//
// This video deliberately starts a real one-off Studio render. Testing or
// recording it therefore consumes one render. Keep agent.mp4 short enough that
// the complete pitch remains below two minutes (roughly 20-25 seconds).
const projectName = process.env.SCREENCI_PITCH_PROJECT_NAME ?? 'demo-saas'
const videoName = process.env.SCREENCI_PITCH_VIDEO_NAME ?? 'Vertical invoice'
const agentRecording = fileURLToPath(
  new URL('../assets/agent.mp4', import.meta.url)
)

const overlays = createOverlays({
  agentSession: {
    path: '../assets/agent.mp4',
    fullScreen: true,
    // The launch narration explains this condensed recording, so mute any
    // incidental screen-recorder audio in the source clip.
    audio: 0,
  },
})

video.use({
  renderOptions: {
    narration: {
      voice: {
        name: voices.Sophie,
        style: 'Calm, direct developer presenting a real product workflow',
      },
    },
  },
})

video.localize({
  narration: {
    en: {
      intro:
        'This video shows how a coding agent and ScreenCI [pronounce: screen see eye] turn a product flow into a finished product video.',
      agent:
        'I asked the agent to create a narrated walkthrough for this sample SaaS application. This is the actual session, condensed.',
      source:
        'It reads the application, then writes and tests a Playwright-style video file in the repository.',
      oneOff:
        'The flow is already recorded, so I can render a one-off version without recording the application again.',
      rendering:
        'This is the real render job, combining the recording, narration, camera motion, and overlays.',
      privacy:
        'The application, source, session, and credentials stayed local. Only the recording and timing data were uploaded.',
      delivery:
        'The finished video is ready to review, download, or publish through a stable public URL.',
      maintenance:
        'Run the source locally or in CI. If the product flow changes, it fails visibly instead of leaving a stale walkthrough online.',
      more: 'One recording can produce language versions with synchronized narration and subtitles, cloned voices, and React or HTML overlays.',
      outro:
        'That is ScreenCI [pronounce: screen see eye]: from a coding-agent prompt to a product video you can rerun whenever the product changes.',
    },
  },
})('ScreenCI product pitch', async ({ page, narration }) => {
  video.skip(
    !process.env.SCREENCI_APP_STORAGE_STATE,
    'Requires SCREENCI_APP_STORAGE_STATE with a logged-in ScreenCI app session.'
  )
  video.skip(
    !existsSync(agentRecording),
    'Add the condensed agent capture at screenci/assets/agent.mp4.'
  )

  // Start in Studio for the video produced during the captured agent session.
  // Authentication and dashboard navigation are setup, so they are not shown.
  await hide(async () => {
    await page.goto('https://app.screenci.com/')
    await page.waitForLoadState('networkidle')

    const projects = page.getByTestId('projects-list')
    await expect(projects).toBeVisible({ timeout: 30_000 })
    await projects.getByRole('link', { name: projectName, exact: true }).click()

    await page.getByRole('link', { name: videoName, exact: true }).click()
    await expect(page.getByRole('heading', { name: /languages/i })).toBeVisible(
      { timeout: 30_000 }
    )

    await page.getByRole('link', { name: /open in studio/i }).click()
    await expect(page.getByRole('heading', { name: /^studio$/i })).toBeVisible({
      timeout: 30_000,
    })
  })

  await narration.intro()

  // agent.mp4 uses its natural duration. Keep it condensed to 20-25 seconds.
  await narration.agent.start()
  await overlays.agentSession()
  await narration.agent.end()

  await narration.source()

  // This is an intentional real side effect: every run starts one new Studio
  // render for the selected language.
  await narration.oneOff.start()
  await autoZoom(async () => {
    await page.getByRole('button', { name: 'Create one-off version' }).click()

    const dialog = page.getByRole('alertdialog')
    await expect(
      dialog.getByRole('heading', { name: 'Create a one-off version' })
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Continue' }).click()

    const renderButton = page.getByRole('button', {
      name: /^Render one-off [A-Z-]+$/,
    })
    await expect(renderButton).toBeEnabled()
    await renderButton.click()
  })
  await expect(
    page.getByText(/One-off render started for [A-Z-]+\./)
  ).toBeVisible({ timeout: 30_000 })
  await narration.oneOff.end()

  await narration.rendering.start()
  await page.getByRole('link', { name: /view render/i }).click()
  await expect(
    page.getByRole('heading', { name: /^Studio render/ })
  ).toBeVisible({ timeout: 30_000 })
  await narration.rendering.end()

  // Show the genuine progress UI, but cut the unpredictable cloud wait from
  // the final timeline. A fast render may already be complete at this point.
  await page.waitForTimeout(1_500)
  await hide(async () => {
    await expect(
      page.getByText('Rendering complete', { exact: true })
    ).toBeVisible({ timeout: 10 * 60_000 })
  })

  await narration.privacy()

  // Open the finished one-off version from the render-run page.
  const finishedVersion = page
    .getByRole('link')
    .filter({ hasText: /View\s*→/ })
    .first()
  await expect(finishedVersion).toBeVisible()
  await finishedVersion.click()

  await expect(page.getByRole('heading', { name: /^v\d+$/ })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByTestId('video-loading-overlay')).toBeHidden({
    timeout: 30_000,
  })

  // Let the generated product video demonstrate itself without narration over
  // it. Twelve seconds is enough to establish the output while keeping the
  // complete pitch below two minutes.
  const playButton = page.getByRole('button', { name: /^play$/i })
  await expect(playButton).toBeVisible()
  await playButton.click()
  await page.waitForTimeout(12_000)
  const pauseButton = page.getByRole('button', { name: /^pause$/i })
  if (await pauseButton.isVisible()) {
    await pauseButton.click()
  }

  await narration.delivery()
  await zoomTo(page.getByRole('button', { name: 'Download Video' }))
  await page.waitForTimeout(700)
  await resetZoom()

  await narration.maintenance()

  // Return to the video overview so the language and delivery surfaces support
  // the final feature summary visually.
  await page.getByRole('link', { name: videoName, exact: true }).click()
  await expect(page.getByRole('heading', { name: /languages/i })).toBeVisible({
    timeout: 30_000,
  })

  await zoomTo(page.getByRole('heading', { name: /languages/i }))
  await narration.more()
  await resetZoom()

  await narration.outro()
})
