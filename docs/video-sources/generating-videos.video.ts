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
  voice: { name: voices.Sophie, style: 'Clear, structured docs walkthrough' },
  languages: {
    en: {
      cues: {
        intro:
          'This video shows how the Generating Videos guide covers source based, URL based, and codegen driven starting points.',
        source:
          'The embedded source shows the exact ScreenCI script behind this documentation walkthrough.',
        section:
          'One of the core sections focuses on generating videos directly from source code in the same repository.',
        next: 'From here, the next step is learning how to run and debug the draft locally.',
      },
    },
  },
})

video('Generating videos guide', async ({ page }) => {
  await hide(async () => {
    await page.goto('/docs/generating-videos')
    await waitForDocHeading(page, 'Generating Videos')
  })

  await narration.intro()
  await narration.source.start()
  await autoZoom(async () => {
    await openSourceDetails(page)
  })
  await narration.source.end()

  await narration.section()
  await zoomTo(
    page.getByRole('heading', { name: 'AI generation based on source code' })
  )
  await page.waitForTimeout(700)
  await resetZoom()

  await narration.next()
  await autoZoom(async () => {
    await clickContentLink(page, 'Run and Debug Videos')
  })

  await waitForDocHeading(page, 'Run and Debug Videos')
})
