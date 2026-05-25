import { autoZoom, createNarration, hide, video, voices } from 'screenci'
import { waitForDocHeading } from './docs-shared'

const narration = createNarration({
  voice: { name: voices.Sophie, style: 'Clear, friendly product walkthrough' },
  languages: {
    en: {
      cues: {
        intro:
          'This video shows how to get started with ScreenCI [pronounce: screen see eye].',
        docs: 'You can find the documentation linked right on the front page.',
      },
    },
  },
})

video('How to get started', async ({ page }) => {
  await hide(async () => {
    await page.goto('/')
    await page.getByText('ScreenCI').first().waitFor()
  })

  await narration.intro()
  await narration.docs()

  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })

  await waitForDocHeading(page, 'Installation')
})
