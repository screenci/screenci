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
          'This video walks through the local authoring loop in the Run and Debug Videos guide.',
        source:
          'As with the other docs pages, the ScreenCI source is available right on the page.',
        focus:
          'A key section shows how to run one file or a filtered subset while you iterate.',
        next: 'Once the local flow looks right, the docs move on to recording and publishing.',
      },
    },
  },
})

video('Run and debug videos guide', async ({ page }) => {
  await hide(async () => {
    await page.goto('/docs/run-and-debug-videos')
    await waitForDocHeading(page, 'Run and Debug Videos')
  })

  await narration.intro()
  await narration.source.start()
  await autoZoom(async () => {
    await openSourceDetails(page)
  })
  await narration.source.end()

  await narration.focus()
  await zoomTo(page.getByRole('heading', { name: 'Run one file or a subset' }))
  await page.waitForTimeout(700)
  await resetZoom()

  await narration.next()
  await autoZoom(async () => {
    await clickContentLink(page, 'Record and Publish')
  })

  await waitForDocHeading(page, 'Record and Publish')
})
