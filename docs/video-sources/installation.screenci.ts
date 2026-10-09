import { autoZoom, hide, video } from 'screenci'

// One video per file: recordings/<name>.screenci.ts. Files only this video
// uses go in recordings/<name>/, files several videos use in recordings/shared/.
video
  .overlays({
    logo: {
      path: './shared/logo.png',
      duration: 2000,
      overMouse: true,
      fill: 'recording',
    },
  })
  .narration({
    docs: 'Here is where to find the ScreenCI docs.',
  })('How to find docs', async ({ page, narration, overlays }) => {
  // Run setup without showing these actions in the final recording.
  await hide(async () => {
    await page.goto('https://screenci.com/')
  })

  // Open with a brief brand intro card before the walkthrough begins.
  await overlays.logo.for(2000)

  // Play the narration for this part of the flow.
  await narration.docs()

  // Automatically zoom into interactions so they are easier to follow.
  await autoZoom(async () => {
    await page.getByRole('link', { name: 'Read the docs' }).click()
  })
})
