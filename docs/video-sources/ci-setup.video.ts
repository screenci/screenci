import {
  autoZoom,
  createNarration,
  hide,
  resetZoom,
  video,
  voices,
  zoomTo,
} from 'screenci'

const narration = createNarration({
  voice: { name: voices.Sophie },
  languages: {
    en: {
      cues: {
        intro:
          'This video highlights the default GitHub Actions recording workflow described in the CI Setup page.',
        source:
          'The source details let you compare the final walkthrough with the authoring script.',
        focus:
          'Further down, the guide explains how to keep CI recordings deterministic and repeatable.',
        next: 'The related publishing guide for public delivery is linked at the end of the page.',
      },
    },
  },
})

video('CI setup guide', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/docs/ci-setup')
    await page.waitForLoadState('networkidle')
  })

  await narration.intro()
  await narration.source.start()
  await autoZoom(async () => {
    await page.getByText('Show source').first().click()
  })
  await narration.source.end()

  await narration.focus()
  await zoomTo(
    page.getByRole('heading', { name: 'Keep recordings deterministic' })
  )
  await page.waitForTimeout(700)
  await resetZoom()

  await narration.next()
  await autoZoom(async () => {
    await page
      .locator('.sl-markdown-content')
      .getByRole('link', { name: 'Public URLs and Embeds', exact: true })
      .first()
      .click()
  })

  await page.waitForLoadState('networkidle')
})
