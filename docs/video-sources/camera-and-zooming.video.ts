import {
  autoZoom,
  createNarration,
  hide,
  resetZoom,
  video,
  voices,
  zoomTo,
} from 'screenci'
import {
  clickContentLink,
  openSourceDetails,
  waitForDocHeading,
} from './docs-shared'

const narration = createNarration({
  voice: { name: voices.Sophie },
  languages: {
    en: {
      cues: {
        intro:
          'This video walks through the two camera styles covered in the Camera and Zooming guide.',
        source:
          'The page includes the complete ScreenCI script used for this walkthrough.',
        focus:
          'The manual zoom section shows when to take exact control over framing instead of following the interaction automatically.',
        next: 'The related reference page for authoring helpers is linked from the end of the guide.',
      },
    },
  },
})

video('Camera and zooming guide', async ({ page }) => {
  await hide(async () => {
    await page.goto('/docs/guides/camera-and-zooming')
    await waitForDocHeading(page, 'Camera and Zooming')
  })

  await narration.intro()
  await narration.source.start()
  await autoZoom(async () => {
    await openSourceDetails(page)
  })
  await narration.source.end()

  await narration.focus()
  await zoomTo(page.getByRole('heading', { name: 'Manual zoom' }))
  await page.waitForTimeout(700)
  await resetZoom()

  await narration.next()
  await autoZoom(async () => {
    await clickContentLink(page, 'Video Authoring API Overview')
  })

  await waitForDocHeading(page, 'Video Authoring API Overview')
})
