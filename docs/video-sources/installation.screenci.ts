import { autoZoom, hide, video } from 'screenci'

video
  .overlays({
    logo: { path: './assets/logo.png', duration: '2s', overMouse: true },
  })
  .narration({
    docs: 'Here is where to find ScreenCI [pronounce: screen see eye] docs.',
  })('How to find docs', async ({ page, narration, overlays }) => {
  // Run setup without showing these actions in the final recording.
  await hide(async () => {
    await page.goto('https://screenci.com/')
  })

  // Open with a brief brand intro card before the walkthrough begins.
  await overlays.logo.for('2s')

  // Play the narration line for this step.
  await narration.docs()

  // Automatically zoom into interactions so they are easier to follow.
  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })
})
