import { expect, type Locator } from '@playwright/test'
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
const appUrl =
  process.env.SCREENCI_PITCH_APP_URL ??
  process.env.SCREENCI_APP_URL ??
  'https://app.screenci.com/'
const placeholderMode = process.env.SCREENCI_PITCH_PLACEHOLDER === 'true'
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
        'The flow is already recorded, so Studio can render a one-off version without recording the application again.',
      rendering:
        'Render progress belongs on the recording page: one job, all outputs, and a clear status while the cloud render runs.',
      privacy:
        'The application, source, session, and credentials stayed local. Only the recording and timing data were uploaded.',
      delivery:
        'The finished video is ready to review, download, or publish through a stable public URL.',
      maintenance:
        'Run the source locally or in CI. If the product flow changes, the recording fails visibly instead of leaving stale software marketing online.',
      features:
        'The same source also gives you language versions, synchronized subtitles, voice controls, cloned voices, render options, React or HTML overlays, public URLs, embeds, screenshots, and CI reruns.',
      outro:
        'That is ScreenCI [pronounce: screen see eye]: from a coding-agent prompt to a product video you can rerun whenever the product changes.',
    },
  },
})('ScreenCI product pitch', async ({ page, narration }) => {
  let projectUrl = appUrl
  let videoOverviewUrl = appUrl
  let languageUrl = appUrl

  video.skip(
    !placeholderMode && !process.env.SCREENCI_APP_STORAGE_STATE,
    'Requires SCREENCI_APP_STORAGE_STATE with a logged-in ScreenCI app session.'
  )
  video.skip(
    !existsSync(agentRecording),
    'Add the condensed agent capture at screenci/assets/agent.mp4.'
  )

  if (placeholderMode) {
    await hide(async () => {
      await page.goto(appUrl)
      await page.waitForLoadState('networkidle')
    })

    await narration.intro()
    await overlays.agentSession()
    await narration.outro()
    return
  }

  const visible = async (locator: Locator, timeout = 2_000) =>
    locator
      .first()
      .isVisible({ timeout })
      .catch(() => false)

  const zoomGlimpse = async (locator: Locator, ms = 850) => {
    const target = locator.first()
    if (!(await visible(target, 5_000))) return false

    await target.scrollIntoViewIfNeeded().catch(() => undefined)
    await zoomTo(target)
    await page.waitForTimeout(ms)
    await resetZoom()
    return true
  }

  const gotoHidden = async (url: string, waitForReady: () => Promise<void>) => {
    await hide(async () => {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      await waitForReady()
    })
  }

  const showRenderPageGlimpse = async () => {
    const renderProgress = page
      .getByText(/renders finished/i)
      .locator('xpath=ancestor::section[1]')
    if (await zoomGlimpse(renderProgress, 1_100)) return

    await zoomGlimpse(
      page.getByRole('heading', { name: /^(one-off render|recording)/i }),
      1_000
    )
  }

  const openLatestRecordRun = async () => {
    let opened = false
    await hide(async () => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')
      await expect(
        page.getByRole('heading', { name: /^videos$/i })
      ).toBeVisible({ timeout: 30_000 })

      const recordRun = page.locator('a[href^="/record/"]').first()
      if (await visible(recordRun, 5_000)) {
        await recordRun.click()
        await expect(
          page.getByRole('heading', {
            name: /^(one-off render|recording)/i,
          })
        ).toBeVisible({ timeout: 30_000 })
        opened = true
      }
    })
    return opened
  }

  const showFeatureGlimpses = async () => {
    await gotoHidden(videoOverviewUrl, async () => {
      await expect(
        page.getByRole('heading', { name: /language versions/i })
      ).toBeVisible({ timeout: 30_000 })
    })
    await zoomGlimpse(
      page.getByRole('heading', { name: /language versions/i }),
      800
    )
    await zoomGlimpse(
      page.getByRole('heading', { name: /public url & api/i }),
      800
    )

    await gotoHidden(languageUrl, async () => {
      await expect(
        page.getByRole('heading', { name: /^studio$/i })
      ).toBeVisible({ timeout: 30_000 })
    })
    await zoomGlimpse(page.getByRole('heading', { name: /^narration$/i }), 700)
    await zoomGlimpse(
      page.getByRole('heading', { name: /^render options$/i }),
      700
    )
    await zoomGlimpse(page.getByRole('heading', { name: /^overlays$/i }), 700)
  }

  const showCiGlimpse = async () => {
    await hide(async () => {
      await page.goto(projectUrl)
      await page.waitForLoadState('networkidle')
      await expect(
        page.getByRole('heading', { name: /^videos$/i })
      ).toBeVisible({ timeout: 30_000 })

      const editSettings = page.getByRole('button', {
        name: /edit github settings/i,
      })
      const setupRecording = page.getByRole('button', {
        name: /set up recording trigger/i,
      })
      if (await visible(editSettings, 1_000)) {
        await editSettings.click()
      } else if (await visible(setupRecording, 1_000)) {
        await setupRecording.click()
      }
    })

    if (
      await zoomGlimpse(page.getByText(/GitHub recording workflow/i), 1_000)
    ) {
      return
    }
    await zoomGlimpse(
      page.getByRole('button', {
        name: /record all|set up recording trigger/i,
      }),
      900
    )
  }

  // Start in Studio for the video produced during the captured agent session.
  // Authentication and dashboard navigation are setup, so they are not shown.
  await hide(async () => {
    await page.goto(appUrl)
    await page.waitForLoadState('networkidle')

    const projects = page.getByTestId('projects-list')
    await expect(projects).toBeVisible({ timeout: 30_000 })
    const configuredProject = projects.getByRole('link', {
      name: projectName,
      exact: true,
    })
    const projectLink =
      (await configuredProject.count()) > 0
        ? configuredProject
        : projects.getByRole('link').first()
    await projectLink.click()
    await expect(page.getByRole('heading', { name: /^videos$/i })).toBeVisible({
      timeout: 30_000,
    })
    projectUrl = page.url()

    const configuredVideo = page.getByRole('link', {
      name: videoName,
      exact: true,
    })
    const videoLink =
      (await configuredVideo.count()) > 0
        ? configuredVideo
        : page.locator('a[href*="/video/"]').first()
    await videoLink.click()
    await expect(
      page.getByRole('heading', { name: /language versions/i })
    ).toBeVisible({ timeout: 30_000 })
    videoOverviewUrl = page.url()

    await page
      .getByRole('link', { name: /^open /i })
      .first()
      .click()
    await expect(page.getByRole('heading', { name: /^studio$/i })).toBeVisible({
      timeout: 30_000,
    })
    languageUrl = page.url()
  })

  await narration.intro()

  // agent.mp4 uses its natural duration. Keep it condensed to 20-25 seconds.
  await narration.agent.start()
  await overlays.agentSession()
  await narration.agent.end()

  await narration.source()

  const createOneOffButton = page.getByRole('button', {
    name: 'Create one-off version',
  })
  const canCreateOneOff = await createOneOffButton
    .isVisible({ timeout: 5_000 })
    .catch(() => false)

  if (!canCreateOneOff) {
    await narration.oneOff.start()
    await zoomTo(page.getByRole('heading', { name: /^studio$/i }))
    await page.waitForTimeout(900)
    await resetZoom()
    await narration.oneOff.end()

    if (await openLatestRecordRun()) {
      await narration.rendering.start()
      await showRenderPageGlimpse()
      await narration.rendering.end()
    }

    await narration.features.start()
    await showFeatureGlimpses()
    await narration.features.end()

    await narration.privacy()

    await narration.maintenance.start()
    await showCiGlimpse()
    await narration.maintenance.end()

    await narration.delivery()

    await narration.outro()
    return
  }

  // This is an intentional real side effect when the authenticated workspace has
  // Studio rendering enabled: every run starts one new Studio render for the
  // selected language. Read-only CI workspaces take the fallback above.
  await narration.oneOff.start()
  await autoZoom(async () => {
    await createOneOffButton.click()

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
    page.getByRole('heading', { name: /^(one-off render|recording)/i })
  ).toBeVisible({ timeout: 30_000 })
  await showRenderPageGlimpse()
  await narration.rendering.end()

  // Show the genuine progress UI, but cut the unpredictable cloud wait from
  // the final timeline. A fast render may already be complete at this point.
  await page.waitForTimeout(1_500)
  await hide(async () => {
    await expect(
      page.getByText('Rendering complete', { exact: true })
    ).toBeVisible({ timeout: 10 * 60_000 })
  })

  // Open the finished one-off version from the render-run page.
  const finishedVersion = page
    .locator('a[href*="/language/"][href*="?v="]')
    .first()
  await expect(finishedVersion).toBeVisible()
  await finishedVersion.click()

  await expect(page.getByRole('heading', { name: /^versions$/i })).toBeVisible({
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

  await narration.features.start()
  await showFeatureGlimpses()
  await narration.features.end()

  await narration.privacy()

  await narration.maintenance.start()
  await showCiGlimpse()
  await narration.maintenance.end()

  await narration.outro()
})
