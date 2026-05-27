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
          'This video introduces the Narration and Localization guide for cue based speech and multi language output.',
        source:
          'The source block shows how the guide video itself uses narration cues and typed source.',
        focus:
          'One of the most important sections explains how to overlap spoken cues with visible motion.',
        next: 'The next guide expands from narration into camera movement and zooming.',
      },
    },
  },
})

video('Narration and localization guide', async ({ page }) => {
  await hide(async () => {
    await page.goto('/docs/guides/narration-and-localization')
    await page.waitForLoadState('networkidle')
  })

  await narration.intro()
  await narration.source.start()
  await autoZoom(async () => {
    await page.getByText('Show source').first().click()
  })
  await narration.source.end()

  await narration.focus()
  await zoomTo(page.getByRole('heading', { name: 'Timing modes' }))
  await page.waitForTimeout(700)
  await resetZoom()

  await narration.next()
  await autoZoom(async () => {
    await page
      .getByRole('link', { name: 'Camera and zooming', exact: true })
      .first()
      .click()
  })

  await page.waitForLoadState('networkidle')
})
