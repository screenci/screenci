import {
  autoZoom,
  hide,
  resetRecordingSize,
  resetZoom,
  resizeRecording,
  video,
  voices,
  zoomTo,
} from 'screenci'

video.use({
  renderOptions: {
    narration: {
      voice: { name: voices.Sophie, style: 'Friendly product guide' },
    },
    output: {
      background: {
        backgroundCss: 'linear-gradient(313deg, #ffffff 0%, #d6d6d6 100%)',
      },
    },
  },
})

// Camera walkthrough for the Camera and Zooming guide. It records the public
// marketing site (screenci.com), so it needs no login. The mirror in
// screenci/videos strips the screenci.com origin so the gotos route through the
// configured baseURL.
video.narration({
  en: {
    auto: 'autoZoom [pronounce: auto zoom] follows a cluster of related actions on its own.',
    manual:
      'zoomTo [pronounce: zoom to] frames an exact target before you interact with it.',
    pan: 'Give it a point instead of an element for a deliberate pan.',
    step: 'resizeRecording [pronounce: resize recording] steps back to reveal the styled background.',
    outro: 'Treat the camera as direction, not decoration.',
  },
})('Camera and zooming', async ({ page, narration }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/')
    await page.waitForLoadState('networkidle')
  })

  // autoZoom follows the interaction automatically as it opens the docs.
  await narration.auto.start()
  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })
  await narration.auto.end()
  await page.waitForLoadState('networkidle')

  // Manual framing on an exact target before any interaction.
  await narration.manual.start()
  await zoomTo(page.getByRole('heading', { level: 1 }).first())
  await page.waitForTimeout(900)
  await narration.manual.end()

  // A deliberate pan to a hand-picked point, then back to the full frame.
  await narration.pan.start()
  await zoomTo({ x: 1200, y: 680 })
  await page.waitForTimeout(900)
  await resetZoom()
  await narration.pan.end()

  // Step the recording back to show the styled background, then restore it.
  await narration.step.start()
  await resizeRecording(0.8)
  await page.waitForTimeout(900)
  await resetRecordingSize()
  await narration.step.end()

  await narration.outro()
})
