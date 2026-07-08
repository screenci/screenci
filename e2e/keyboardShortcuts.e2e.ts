import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { instrumentPage, setActiveClickRecorder } from '../src/instrument.js'
import { EventRecorder } from '../src/events.js'
import type { KeyPressEvent } from '../src/events.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureHtml = readFileSync(
  resolve(__dirname, 'fixtures/index.html'),
  'utf-8'
)

let recorder: EventRecorder

function keyPressEvents(): KeyPressEvent[] {
  return recorder
    .getEvents()
    .filter((event): event is KeyPressEvent => event.type === 'keyPress')
}

test.beforeEach(async ({ page }) => {
  await instrumentPage(page)
  await page.setContent(fixtureHtml)
  recorder = new EventRecorder()
  recorder.start()
  setActiveClickRecorder(recorder)
})

test.afterEach(() => {
  setActiveClickRecorder(null)
})

test.describe('keyboard shortcut recording', () => {
  test('records page.keyboard.press combos with stable ids', async ({
    page,
  }) => {
    await page.keyboard.press('Shift+A')
    await page.keyboard.press('A')

    const events = keyPressEvents()
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      id: 'kp-0',
      keys: ['Shift', 'A'],
    })
    expect(events[0]!.show).toBeUndefined()
    expect(events[1]).toMatchObject({ id: 'kp-1', keys: ['A'] })
    expect(events[1]!.timeMs).toBeGreaterThanOrEqual(events[0]!.timeMs)
  })

  test('resolves ControlOrMeta to the recording platform key', async ({
    page,
  }) => {
    await page.keyboard.press('ControlOrMeta+K')

    const expected = process.platform === 'darwin' ? 'Meta' : 'Control'
    expect(keyPressEvents()[0]!.keys).toEqual([expected, 'K'])
  })

  test('records the per-call show flag and strips it from Playwright options', async ({
    page,
  }) => {
    const press = page.keyboard.press as (
      key: string,
      options?: { delay?: number; show?: boolean }
    ) => Promise<void>
    await press('ControlOrMeta+K', { show: true })
    await press('Escape', { show: false })

    const events = keyPressEvents()
    expect(events[0]!.show).toBe(true)
    expect(events[1]!.show).toBe(false)
  })

  test('locator.press records a keyPress and still types into the element', async ({
    page,
  }) => {
    const input = page.locator('#text-input')
    const press = input.press.bind(input) as (
      key: string,
      options?: { show?: boolean }
    ) => Promise<void>
    await input.focus()
    await press('A', { show: true })

    const events = keyPressEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ keys: ['A'], show: true })
    await expect(input).toHaveValue('A')
  })
})
