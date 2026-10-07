/**
 * The compact "agent card": everything a coding agent needs to go from a
 * copied prompt to a ScreenCI preview link, in about 30 lines. Printed by
 * `init --brief` and reused (rules, common edits) by `setup`.
 */

export type AgentCardInput = {
  /** The screenci run prefix, e.g. `npx screenci`. */
  run: string
  /** The workspace folder, as the agent should `cd` to it. */
  dir: string
  /** The video title, when known. */
  title?: string
  /** The page the video starts on, when known. */
  url?: string
}

/** One-line authoring rules shared by the card and the setup brief. */
export function agentCardRules(run = 'npx screenci'): readonly string[] {
  return [
    'Start on the page or URL named in the prompt (not the home page) inside hide(); show only the requested flow, nothing extra.',
    'Open by stating the purpose, then narrate the flow (not the clicks) as the company: "we"/"our", the viewer is "you".',
    'Use plausible mock data presented as real (never call it mock or test); on a production site never submit real-world forms (orders, payments, emails): end on the filled form.',
    'No overlays, zoom, or timing overrides unless asked.',
    'To scroll, call `scrollIntoViewIfNeeded({ centering: 1, duration: 1500 })` on the last element to show (longer duration for a long page). End on a settled frame: narrate the last step as it happens, then `await page.waitForTimeout(1000)`.',
    `Explore with \`npx playwright-cli\` (from the screenci dir) or \`${run} explore <url>\`, never a Playwright script of your own.`,
    'No browser of your own: explore and preview run headless; report the preview (or export) link the command prints, do not open it.',
    `Never ask for a password or code; \`${run} login\` is the only sign-in path.`,
  ]
}

/** One-line recipes for the edits people ask for most. */
export function agentCardCommonEdits(): readonly string[] {
  return [
    'Cursor speed: `click({ move: { duration: 400 } })` or `click({ move: { speed: 2000 } })`; no pause after a click: `click({ delayAfter: 0 })`.',
    'Speed up a section: `await speed(2, async () => { ... })`.',
    'Zoom: wrap actions in `autoZoom(async () => { ... })`, or `zoomTo(locator)` / `resetZoom()`.',
    'Narration: edit the text in `video.narration({...})`; voice via `video.renderOptions({ narration: { voice: { name: voices.Ava } } })` (import `voices` from screenci).',
    'Overlays: follow the screenci skill reference overlays.md.',
    'Screenshots: `screenshot("<title>", async ({ page, clip }) => { ... })`.',
  ]
}

export function formatAgentCard(input: AgentCardInput): string {
  const title = input.title ?? '<Video title>'
  const url = input.url ?? 'https://example.com/'
  const lines: string[] = [
    `## ScreenCI: write recordings/<flow>.screenci.ts in ${input.dir}/`,
    '```ts',
    "import { autoZoom, hide, video } from 'screenci'",
    'video.narration({ en: { intro: "Here is how we ...", step: "Now you ..." } })(',
    `  ${JSON.stringify(title)},`,
    '  async ({ page, narration }) => {',
    `    await hide(async () => { await page.goto(${JSON.stringify(url)}) })`,
    '    await narration.intro()',
    '    await narration.step()',
    "    await autoZoom(() => page.getByRole('button', { name: 'Start' }).click())",
    '  }',
    ')',
    '```',
    'Rules:',
    ...agentCardRules(input.run).map((rule) => `- ${rule}`),
    'Common edits:',
    ...agentCardCommonEdits().map((edit) => `- ${edit}`),
    'Commands:',
    `- cd ${input.dir} && ${input.run} preview ${JSON.stringify(title)}  (runs the script and prints the link; \`test <file>\` only to debug a failure)`,
    'Report in plain language; put the preview link on the last line.',
  ]
  return lines.join('\n')
}

/**
 * The `init --brief` ending: the agent card plus one line on the secret and
 * the terms, instead of the human-oriented next steps.
 */
export function formatInitBriefOutput(params: {
  run: string
  dir: string
  secretReady: boolean
  secretsUrl: string
  termsUrl: string
}): string {
  const secretLine = params.secretReady
    ? 'SCREENCI_SECRET is set'
    : `previews need no SCREENCI_SECRET (export does: ${params.secretsUrl} into ${params.dir}/.env)`
  return [
    formatAgentCard({ run: params.run, dir: params.dir }),
    `Created ${params.dir}/; ${secretLine}. Recording during an anonymous trial agrees to the terms: ${params.termsUrl}`,
  ].join('\n')
}
