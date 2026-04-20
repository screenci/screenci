import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  instrumentPage,
  scrollTo,
  setActiveClickRecorder,
} from '../src/instrument.js'
import { EventRecorder } from '../src/events.js'
import type {
  InputEvent,
  MouseMoveEvent,
  MouseDownEvent,
  MouseUpEvent,
  MouseHideEvent,
  MouseWaitEvent,
} from '../src/events.js'
import type {
  ClickBeforeFillOption,
  Easing,
  PostClickMove,
} from '../src/types.js'
import type { Locator, Page } from '@playwright/test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureHtml = readFileSync(
  resolve(__dirname, 'fixtures/index.html'),
  'utf-8'
)

// Helper type: locator with the click option our instrumentation adds
type WithClick<T> = T & { click?: ClickBeforeFillOption }

function checkLocator(locator: Locator): {
  check(opts?: WithClick<Parameters<Locator['check']>[0]>): Promise<void>
} {
  return locator as never
}
function uncheckLocator(locator: Locator): {
  uncheck(opts?: WithClick<Parameters<Locator['uncheck']>[0]>): Promise<void>
} {
  return locator as never
}
function tapLocator(locator: Locator): {
  tap(opts?: WithClick<Parameters<Locator['tap']>[0]>): Promise<void>
} {
  return locator as never
}
function clickableLocator(locator: Locator): {
  click(
    opts?: Parameters<Locator['click']>[0] & {
      moveDuration?: number
      moveSpeed?: number
      beforeClickPause?: number
      moveEasing?: Easing
      postClickPause?: number
      postClickMove?: PostClickMove
    }
  ): Promise<void>
} {
  return locator as never
}
function fillableLocator(locator: Locator): {
  fill(
    value: string,
    opts?: {
      duration?: number
      timeout?: number
      click?: ClickBeforeFillOption
      hideMouse?: boolean
    }
  ): Promise<void>
} {
  return locator as never
}
function typeableLocator(locator: Locator): {
  pressSequentially(
    text: string,
    opts?: Parameters<Locator['pressSequentially']>[1] & {
      click?: ClickBeforeFillOption
      hideMouse?: boolean
    }
  ): Promise<void>
} {
  return locator as never
}
function selectableLocator(locator: Locator): {
  selectOption(
    values: Parameters<Locator['selectOption']>[0],
    opts?: Parameters<Locator['selectOption']>[1] & {
      click?: ClickBeforeFillOption
    }
  ): Promise<string[]>
} {
  return locator as never
}

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

let recorder: EventRecorder

function inputEvents(): InputEvent[] {
  return recorder.getEvents().filter((e): e is InputEvent => e.type === 'input')
}

function clickEvents(): InputEvent[] {
  return recorder
    .getEvents()
    .filter((e): e is InputEvent => e.type === 'input' && e.subType === 'click')
}

function mouseMoveEvents(): MouseMoveEvent[] {
  return inputEvents()
    .filter((e) => e.subType === 'mouseMove')
    .flatMap((e) =>
      e.events.filter((ie): ie is MouseMoveEvent => ie.type === 'mouseMove')
    )
}

function mouseHideEventsIn(event: InputEvent): MouseHideEvent[] {
  return event.events.filter((e): e is MouseHideEvent => e.type === 'mouseHide')
}

type InstrumentedMouse = {
  move(
    x: number,
    y: number,
    options?: {
      steps?: number
      duration?: number
      speed?: number
      easing?: string
    }
  ): Promise<void>
}

async function scrollY(page: Page) {
  return page.evaluate(() => window.scrollY)
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

// ---------------------------------------------------------------------------
// click
// ---------------------------------------------------------------------------

test.describe('click instrumentation', () => {
  test('records a click event', async ({ page }) => {
    await clickableLocator(page.locator('#click-button')).click({
      moveDuration: 50,
    })

    const events = clickEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    const move = event!.events.find(
      (e): e is MouseMoveEvent => e.type === 'mouseMove'
    )!
    const down = event!.events.find(
      (e): e is MouseDownEvent => e.type === 'mouseDown'
    )!
    const up = event!.events.find(
      (e): e is MouseUpEvent => e.type === 'mouseUp'
    )!
    expect(move.x).toBeGreaterThan(0)
    expect(move.y).toBeGreaterThan(0)
    expect(move.endMs).toBeGreaterThanOrEqual(move.startMs)
    expect(up.endMs).toBeGreaterThanOrEqual(down.startMs)
  })

  test('actually clicks the button', async ({ page }) => {
    await clickableLocator(page.locator('#click-button')).click({
      moveDuration: 50,
    })
    await expect(page.locator('#click-status')).not.toHaveText('Not clicked')
  })

  test('records elementRect', async ({ page }) => {
    await clickableLocator(page.locator('#click-button')).click({
      moveDuration: 50,
    })

    const events = clickEvents()
    const [event] = events
    expect(event!.elementRect).toBeDefined()
    expect(event!.elementRect!.width).toBeGreaterThan(0)
    expect(event!.elementRect!.height).toBeGreaterThan(0)
  })

  test('scrolls into view before clicking off-screen element', async ({
    page,
  }) => {
    expect(await scrollY(page)).toBe(0)

    await clickableLocator(page.locator('#offscreen-click-button')).click({
      moveDuration: 50,
    })

    expect(await scrollY(page)).toBeGreaterThan(0)
  })

  test('actually clicks an off-screen button after scrolling', async ({
    page,
  }) => {
    await clickableLocator(page.locator('#offscreen-click-button')).click({
      moveDuration: 50,
    })
    await expect(page.locator('#offscreen-click-status')).not.toHaveText(
      'Not clicked'
    )
  })
})

// ---------------------------------------------------------------------------
// fill
// ---------------------------------------------------------------------------

test.describe('fill instrumentation', () => {
  test('records an input event with subType pressSequentially', async ({
    page,
  }) => {
    await fillableLocator(page.locator('#text-input')).fill('hi', {
      duration: 100,
    })

    const events = inputEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.subType).toBe('pressSequentially')
  })

  test('actually fills the input', async ({ page }) => {
    await fillableLocator(page.locator('#text-input')).fill('hello', {
      duration: 100,
    })
    await expect(page.locator('#text-input')).toHaveValue('hello')
  })

  test('records elementRect', async ({ page }) => {
    await fillableLocator(page.locator('#text-input')).fill('x', {
      duration: 50,
    })

    const events = inputEvents()
    const [event] = events
    expect(event!.elementRect).toBeDefined()
    expect(event!.elementRect!.width).toBeGreaterThan(0)
    expect(event!.elementRect!.height).toBeGreaterThan(0)
  })

  test('scrolls into view before filling off-screen input', async ({
    page,
  }) => {
    expect(await scrollY(page)).toBe(0)

    await fillableLocator(page.locator('#offscreen-text-input')).fill(
      'scroll test',
      { duration: 100 }
    )

    expect(await scrollY(page)).toBeGreaterThan(0)
  })

  test('actually fills an off-screen input after scrolling', async ({
    page,
  }) => {
    await fillableLocator(page.locator('#offscreen-text-input')).fill('works', {
      duration: 100,
    })
    await expect(page.locator('#offscreen-text-input')).toHaveValue('works')
  })

  test('with click option: records click sub-events', async ({ page }) => {
    await fillableLocator(page.locator('#text-input')).fill('hi', {
      duration: 100,
      click: { moveDuration: 50 },
    })

    const events = inputEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.subType).toBe('pressSequentially')
    const move = event!.events.find(
      (e): e is MouseMoveEvent => e.type === 'mouseMove'
    )!
    const down = event!.events.find(
      (e): e is MouseDownEvent => e.type === 'mouseDown'
    )!
    const up = event!.events.find(
      (e): e is MouseUpEvent => e.type === 'mouseUp'
    )!
    expect(move).toBeDefined()
    expect(move.x).toBeGreaterThan(0)
    expect(move.endMs).toBeGreaterThanOrEqual(move.startMs)
    expect(up.endMs).toBeGreaterThanOrEqual(down.startMs)
  })

  test('hideMouse: true hides the cursor during fill', async ({ page }) => {
    await fillableLocator(page.locator('#text-input')).fill('hi', {
      duration: 100,
      hideMouse: true,
    })

    const events = inputEvents()
    const [event] = events
    expect(mouseHideEventsIn(event!)).toHaveLength(1)
  })

  test('hideMouse: false does not hide the cursor during fill', async ({
    page,
  }) => {
    await fillableLocator(page.locator('#text-input')).fill('hi', {
      duration: 100,
      hideMouse: false,
    })

    const events = inputEvents()
    const [event] = events
    expect(mouseHideEventsIn(event!)).toHaveLength(0)
  })

  test('does not hide the cursor by default', async ({ page }) => {
    await fillableLocator(page.locator('#text-input')).fill('hi', {
      duration: 100,
    })

    const events = inputEvents()
    const [event] = events
    expect(mouseHideEventsIn(event!)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// pressSequentially
// ---------------------------------------------------------------------------

test.describe('pressSequentially instrumentation', () => {
  test('records an input event with subType pressSequentially', async ({
    page,
  }) => {
    await page.locator('#text-input').pressSequentially('hi', { delay: 30 })

    const events = inputEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.subType).toBe('pressSequentially')
  })

  test('actually types into the input', async ({ page }) => {
    await page.locator('#text-input').pressSequentially('abc', { delay: 30 })
    await expect(page.locator('#text-input')).toHaveValue('abc')
  })

  test('records elementRect', async ({ page }) => {
    await page.locator('#text-input').pressSequentially('x', { delay: 30 })

    const events = inputEvents()
    const [event] = events
    expect(event!.elementRect).toBeDefined()
    expect(event!.elementRect!.width).toBeGreaterThan(0)
  })

  test('scrolls into view before typing in off-screen input', async ({
    page,
  }) => {
    expect(await scrollY(page)).toBe(0)

    await page
      .locator('#offscreen-text-input')
      .pressSequentially('scroll', { delay: 30 })

    expect(await scrollY(page)).toBeGreaterThan(0)
  })

  test('actually types into an off-screen input after scrolling', async ({
    page,
  }) => {
    await page
      .locator('#offscreen-text-input')
      .pressSequentially('done', { delay: 30 })
    await expect(page.locator('#offscreen-text-input')).toHaveValue('done')
  })

  test('with click option: records click sub-events', async ({ page }) => {
    await typeableLocator(page.locator('#text-input')).pressSequentially('hi', {
      delay: 30,
      click: { moveDuration: 50 },
    })

    const events = inputEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.subType).toBe('pressSequentially')
    const move = event!.events.find(
      (e): e is MouseMoveEvent => e.type === 'mouseMove'
    )!
    expect(move).toBeDefined()
    expect(move.endMs).toBeGreaterThanOrEqual(move.startMs)
  })

  test('hideMouse: true hides the cursor during pressSequentially', async ({
    page,
  }) => {
    await typeableLocator(page.locator('#text-input')).pressSequentially('hi', {
      delay: 30,
      hideMouse: true,
    })

    const events = inputEvents()
    const [event] = events
    expect(mouseHideEventsIn(event!)).toHaveLength(1)
  })

  test('hideMouse: false does not hide the cursor during pressSequentially', async ({
    page,
  }) => {
    await typeableLocator(page.locator('#text-input')).pressSequentially('hi', {
      delay: 30,
      hideMouse: false,
    })

    const events = inputEvents()
    const [event] = events
    expect(mouseHideEventsIn(event!)).toHaveLength(0)
  })

  test('does not hide the cursor by default', async ({ page }) => {
    await page.locator('#text-input').pressSequentially('hi', { delay: 30 })

    const events = inputEvents()
    const [event] = events
    expect(mouseHideEventsIn(event!)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

test.describe('check instrumentation', () => {
  test('records an input event with subType check', async ({ page }) => {
    await checkLocator(page.locator('#checkbox-unchecked')).check()

    const events = inputEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.subType).toBe('check')
  })

  test('actually checks the checkbox', async ({ page }) => {
    await checkLocator(page.locator('#checkbox-unchecked')).check()
    await expect(page.locator('#checkbox-unchecked')).toBeChecked()
  })

  test('records elementRect', async ({ page }) => {
    await checkLocator(page.locator('#checkbox-unchecked')).check()

    const events = inputEvents()
    const [event] = events
    expect(event!.elementRect).toBeDefined()
    expect(event!.elementRect!.width).toBeGreaterThan(0)
    expect(event!.elementRect!.height).toBeGreaterThan(0)
  })

  test('scrolls into view before checking off-screen checkbox', async ({
    page,
  }) => {
    expect(await scrollY(page)).toBe(0)

    await checkLocator(page.locator('#offscreen-checkbox-unchecked')).check()

    expect(await scrollY(page)).toBeGreaterThan(0)
  })

  test('actually checks an off-screen checkbox after scrolling', async ({
    page,
  }) => {
    await checkLocator(page.locator('#offscreen-checkbox-unchecked')).check()
    await expect(page.locator('#offscreen-checkbox-unchecked')).toBeChecked()
  })

  test('with click option: animates cursor and records sub-events', async ({
    page,
  }) => {
    await checkLocator(page.locator('#checkbox-unchecked')).check({
      click: { moveDuration: 100 },
    })

    const events = inputEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.subType).toBe('check')
    const move = event!.events.find(
      (e): e is MouseMoveEvent => e.type === 'mouseMove'
    )!
    const down = event!.events.find(
      (e): e is MouseDownEvent => e.type === 'mouseDown'
    )!
    const up = event!.events.find(
      (e): e is MouseUpEvent => e.type === 'mouseUp'
    )!
    expect(move).toBeDefined()
    expect(move.x).toBeGreaterThan(0)
    expect(move.y).toBeGreaterThan(0)
    expect(move.endMs).toBeGreaterThanOrEqual(move.startMs)
    expect(up.endMs).toBeGreaterThanOrEqual(down.startMs)
  })

  test('with click option: actually checks the checkbox', async ({ page }) => {
    await checkLocator(page.locator('#checkbox-unchecked')).check({
      click: { moveDuration: 50 },
    })
    await expect(page.locator('#checkbox-unchecked')).toBeChecked()
  })
})

// ---------------------------------------------------------------------------
// uncheck
// ---------------------------------------------------------------------------

test.describe('uncheck instrumentation', () => {
  test('records an input event with subType uncheck', async ({ page }) => {
    await uncheckLocator(page.locator('#checkbox-checked')).uncheck()

    const events = inputEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.subType).toBe('uncheck')
  })

  test('actually unchecks the checkbox', async ({ page }) => {
    await uncheckLocator(page.locator('#checkbox-checked')).uncheck()
    await expect(page.locator('#checkbox-checked')).not.toBeChecked()
  })

  test('records elementRect', async ({ page }) => {
    await uncheckLocator(page.locator('#checkbox-checked')).uncheck()

    const events = inputEvents()
    const [event] = events
    expect(event!.elementRect).toBeDefined()
    expect(event!.elementRect!.width).toBeGreaterThan(0)
  })

  test('scrolls into view before unchecking off-screen checkbox', async ({
    page,
  }) => {
    expect(await scrollY(page)).toBe(0)

    await uncheckLocator(page.locator('#offscreen-checkbox-checked')).uncheck()

    expect(await scrollY(page)).toBeGreaterThan(0)
  })

  test('actually unchecks an off-screen checkbox after scrolling', async ({
    page,
  }) => {
    await uncheckLocator(page.locator('#offscreen-checkbox-checked')).uncheck()
    await expect(page.locator('#offscreen-checkbox-checked')).not.toBeChecked()
  })

  test('with click option: animates cursor and records sub-events', async ({
    page,
  }) => {
    await uncheckLocator(page.locator('#checkbox-checked')).uncheck({
      click: { moveDuration: 100 },
    })

    const events = inputEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.subType).toBe('uncheck')
    const move = event!.events.find(
      (e): e is MouseMoveEvent => e.type === 'mouseMove'
    )!
    expect(move).toBeDefined()
    expect(move.endMs).toBeGreaterThanOrEqual(move.startMs)
  })

  test('with click option: actually unchecks the checkbox', async ({
    page,
  }) => {
    await uncheckLocator(page.locator('#checkbox-checked')).uncheck({
      click: { moveDuration: 50 },
    })
    await expect(page.locator('#checkbox-checked')).not.toBeChecked()
  })
})

// ---------------------------------------------------------------------------
// tap
// ---------------------------------------------------------------------------

test.describe('tap instrumentation', () => {
  test('records an input event with subType tap', async ({ page }) => {
    await tapLocator(page.locator('#tap-target')).tap()

    const events = inputEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.subType).toBe('tap')
  })

  test('actually triggers the element interaction', async ({ page }) => {
    await tapLocator(page.locator('#tap-target')).tap()
    // The page's pointerup listener updates #tap-status when tapped
    await expect(page.locator('#tap-status')).not.toHaveText('Not yet tapped')
  })

  test('records elementRect', async ({ page }) => {
    await tapLocator(page.locator('#tap-target')).tap()

    const events = inputEvents()
    const [event] = events
    expect(event!.elementRect).toBeDefined()
    expect(event!.elementRect!.width).toBeGreaterThan(0)
    expect(event!.elementRect!.height).toBeGreaterThan(0)
  })

  test('scrolls into view before tapping off-screen element', async ({
    page,
  }) => {
    expect(await scrollY(page)).toBe(0)

    await tapLocator(page.locator('#offscreen-tap-target')).tap()

    expect(await scrollY(page)).toBeGreaterThan(0)
  })

  test('actually taps an off-screen element after scrolling', async ({
    page,
  }) => {
    await tapLocator(page.locator('#offscreen-tap-target')).tap()
    await expect(page.locator('#offscreen-tap-status')).not.toHaveText(
      'Not yet tapped'
    )
  })

  test('with click option: animates cursor and records sub-events', async ({
    page,
  }) => {
    await tapLocator(page.locator('#tap-target')).tap({
      click: { moveDuration: 100 },
    })

    const events = inputEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.subType).toBe('tap')
    // tap doesn't fire a DOM click, so click sub-events use fallback bounding box coords
    const move = event!.events.find(
      (e): e is MouseMoveEvent => e.type === 'mouseMove'
    )!
    expect(move).toBeDefined()
    expect(move.x).toBeGreaterThan(0)
    expect(move.y).toBeGreaterThan(0)
    expect(event!.elementRect!.width).toBeGreaterThan(0)
    expect(move.endMs).toBeGreaterThanOrEqual(move.startMs)
  })

  test('with click option: actually triggers the element interaction', async ({
    page,
  }) => {
    await tapLocator(page.locator('#tap-target')).tap({
      click: { moveDuration: 50 },
    })
    await expect(page.locator('#tap-status')).not.toHaveText('Not yet tapped')
  })
})

// ---------------------------------------------------------------------------
// selectOption
// ---------------------------------------------------------------------------

test.describe('selectOption instrumentation', () => {
  test('records an input event with subType select', async ({ page }) => {
    await selectableLocator(page.locator('#cars')).selectOption('audi')

    const events = inputEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.subType).toBe('select')
  })

  test('actually selects the option', async ({ page }) => {
    await selectableLocator(page.locator('#cars')).selectOption('audi')
    await expect(page.locator('#cars')).toHaveValue('audi')
  })

  test('records elementRect', async ({ page }) => {
    await selectableLocator(page.locator('#cars')).selectOption('saab')

    const events = inputEvents()
    const [event] = events
    expect(event!.elementRect).toBeDefined()
    expect(event!.elementRect!.width).toBeGreaterThan(0)
    expect(event!.elementRect!.height).toBeGreaterThan(0)
  })

  test('scrolls into view before selecting off-screen option', async ({
    page,
  }) => {
    expect(await scrollY(page)).toBe(0)

    await selectableLocator(page.locator('#offscreen-cars')).selectOption(
      'opel'
    )

    expect(await scrollY(page)).toBeGreaterThan(0)
  })

  test('actually selects an off-screen option after scrolling', async ({
    page,
  }) => {
    await selectableLocator(page.locator('#offscreen-cars')).selectOption(
      'volvo'
    )
    await expect(page.locator('#offscreen-cars')).toHaveValue('volvo')
  })

  test('with click option: animates cursor and records sub-events', async ({
    page,
  }) => {
    await selectableLocator(page.locator('#cars')).selectOption('audi', {
      click: { moveDuration: 100 },
    })

    const events = inputEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.subType).toBe('select')
    const move = event!.events.find(
      (e): e is MouseMoveEvent => e.type === 'mouseMove'
    )!
    const down = event!.events.find(
      (e): e is MouseDownEvent => e.type === 'mouseDown'
    )!
    const up = event!.events.find(
      (e): e is MouseUpEvent => e.type === 'mouseUp'
    )!
    expect(move).toBeDefined()
    expect(move.x).toBeGreaterThan(0)
    expect(move.y).toBeGreaterThan(0)
    expect(event!.elementRect!.width).toBeGreaterThan(0)
    expect(move.endMs).toBeGreaterThanOrEqual(move.startMs)
    expect(up.endMs).toBeGreaterThanOrEqual(down.startMs)
  })

  test('with click option: actually selects the option', async ({ page }) => {
    await selectableLocator(page.locator('#cars')).selectOption('saab', {
      click: { moveDuration: 50 },
    })
    await expect(page.locator('#cars')).toHaveValue('saab')
  })

  test('with click option: cursor y is at select center', async ({ page }) => {
    const selectBb = await page.locator('#cars').boundingBox()

    await selectableLocator(page.locator('#cars')).selectOption('audi', {
      click: { moveDuration: 100 },
    })

    const events = inputEvents()
    const [event] = events
    const move = event!.events.find(
      (e): e is MouseMoveEvent => e.type === 'mouseMove'
    )!
    // The click position should be at the select element's center
    expect(move.y).toBeCloseTo(selectBb!.y + selectBb!.height / 2, 0)
  })
})

// ---------------------------------------------------------------------------
// mouse.move
// ---------------------------------------------------------------------------

test.describe('scrollTo helper', () => {
  test('scrolls an off-screen element near the requested viewport height', async ({
    page,
  }) => {
    expect(await scrollY(page)).toBe(0)

    await scrollTo(page.locator('#offscreen-click-button'), 120, 'ease-out')

    const box = await page.locator('#offscreen-click-button').boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeCloseTo(120, 0)
    expect(await scrollY(page)).toBeGreaterThan(0)
  })

  test('scrolls nested scroll containers without scrollIntoView', async ({
    page,
  }) => {
    expect(await scrollY(page)).toBe(0)

    await scrollTo(page.locator('#nested-scroll-target'), 120, 'ease-in-out')

    const box = await page.locator('#nested-scroll-target').boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeGreaterThan(0)
    expect(box!.y).toBeLessThan(800)
    expect(await scrollY(page)).toBeGreaterThan(0)

    const innerScrollTop = await page
      .locator('#nested-scroll-inner')
      .evaluate((el) => (el as HTMLElement).scrollTop)

    expect(innerScrollTop).toBeGreaterThan(0)
  })
})

test.describe('mouse.move instrumentation', () => {
  test('records a mouseMove event with startMs, endMs, x, y', async ({
    page,
  }) => {
    const bb = await page.locator('#click-button').boundingBox()
    const targetX = bb!.x + bb!.width / 2
    const targetY = bb!.y + bb!.height / 2

    await (page.mouse as unknown as InstrumentedMouse).move(targetX, targetY, {
      duration: 100,
    })

    const events = mouseMoveEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.startMs).toBeGreaterThanOrEqual(0)
    expect(event!.endMs).toBeGreaterThanOrEqual(event!.startMs)
    expect(event!.endMs - event!.startMs).toBeGreaterThanOrEqual(100)
    expect(event!.duration).toBeGreaterThanOrEqual(100)
    expect(event!.x).toBeCloseTo(targetX, 0)
    expect(event!.y).toBeCloseTo(targetY, 0)
  })

  test('derives duration from speed and stores it on the mouseMove event', async ({
    page,
  }) => {
    await (page.mouse as unknown as InstrumentedMouse).move(300, 400, {
      speed: 500,
    })

    const events = mouseMoveEvents()
    expect(events).toHaveLength(1)
    const [event] = events
    const expectedDuration = (Math.hypot(300, 400) / 500) * 1000
    expect(event!.duration).toBeCloseTo(expectedDuration, -1)
    expect(event!.endMs - event!.startMs).toBeGreaterThanOrEqual(
      expectedDuration
    )
  })

  test('records easing when duration is provided', async ({ page }) => {
    await (page.mouse as unknown as InstrumentedMouse).move(200, 300, {
      duration: 100,
      easing: 'ease-out',
    })

    const events = mouseMoveEvents()
    expect(events).toHaveLength(1)
    expect(events[0]!.easing).toBe('ease-out')
  })

  test('records mouseMove without easing for instant move', async ({
    page,
  }) => {
    await (page.mouse as unknown as InstrumentedMouse).move(100, 150)

    const events = mouseMoveEvents()
    expect(events).toHaveLength(1)
    expect(events[0]!.x).toBe(100)
    expect(events[0]!.y).toBe(150)
    expect(events[0]!.easing).toBeUndefined()
  })

  test('cursor ends at target position so subsequent click animates from there', async ({
    page,
  }) => {
    // Move cursor to the button, then click it — the click's moveStartTime
    // should be close to moveEndTime (short travel) since cursor is already there.
    const bb = await page.locator('#click-button').boundingBox()
    const targetX = bb!.x + bb!.width / 2
    const targetY = bb!.y + bb!.height / 2

    await (page.mouse as unknown as InstrumentedMouse).move(targetX, targetY, {
      duration: 100,
    })

    await clickableLocator(page.locator('#click-button')).click({
      moveDuration: 50,
    })

    const [click] = clickEvents()
    const move = click!.events.find(
      (e): e is MouseMoveEvent => e.type === 'mouseMove'
    )!
    // The move should be very short since cursor was already at the target
    expect(move.endMs - move.startMs).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// hover
// ---------------------------------------------------------------------------

function hoverableLocator(locator: Locator): {
  hover(
    opts?: Parameters<Locator['hover']>[0] & {
      moveDuration?: number
      easing?: string
      hoverDuration?: number
    }
  ): Promise<void>
} {
  return locator as never
}

test.describe('hover instrumentation', () => {
  test('records a hover event with mouseMove and mouseWait inner events', async ({
    page,
  }) => {
    await hoverableLocator(page.locator('#hover-target')).hover({
      moveDuration: 50,
      hoverDuration: 100,
    })

    const events = inputEvents().filter((e) => e.subType === 'hover')
    expect(events).toHaveLength(1)
    const [event] = events
    const move = event!.events.find(
      (e): e is MouseMoveEvent => e.type === 'mouseMove'
    )!
    const wait = event!.events.find(
      (e): e is MouseWaitEvent => e.type === 'mouseWait'
    )!
    expect(move.x).toBeGreaterThan(0)
    expect(move.y).toBeGreaterThan(0)
    expect(move.endMs).toBeGreaterThanOrEqual(move.startMs)
    expect(wait.endMs).toBeGreaterThanOrEqual(wait.startMs)
  })

  test('actually hovers the element', async ({ page }) => {
    await hoverableLocator(page.locator('#hover-target')).hover({
      moveDuration: 50,
    })
    await expect(page.locator('#hover-status')).toHaveText('Hovered!')
  })

  test('records elementRect on hover', async ({ page }) => {
    await hoverableLocator(page.locator('#hover-target')).hover({
      moveDuration: 50,
    })

    const events = inputEvents().filter((e) => e.subType === 'hover')
    const [event] = events
    expect(event!.elementRect).toBeDefined()
    expect(event!.elementRect!.width).toBeGreaterThan(0)
    expect(event!.elementRect!.height).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// selectText
// ---------------------------------------------------------------------------

function selectTextLocator(locator: Locator): {
  selectText(
    opts?: Parameters<Locator['selectText']>[0] & {
      moveDuration?: number
      easing?: string
      beforeClickPause?: number
      selectDuration?: number
    }
  ): Promise<void>
} {
  return locator as never
}

test.describe('selectText instrumentation', () => {
  test('records a selectText event with mouseMove and 3 down+up pairs', async ({
    page,
  }) => {
    await selectTextLocator(page.locator('#select-text-input')).selectText({
      moveDuration: 50,
      selectDuration: 60,
    })

    const events = inputEvents().filter((e) => e.subType === 'selectText')
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.events.some((e) => e.type === 'mouseMove')).toBe(true)
    expect(event!.events.filter((e) => e.type === 'mouseDown')).toHaveLength(3)
    expect(event!.events.filter((e) => e.type === 'mouseUp')).toHaveLength(3)
  })

  test('actually selects the text', async ({ page }) => {
    await selectTextLocator(page.locator('#select-text-input')).selectText({
      moveDuration: 50,
      selectDuration: 60,
    })
    await expect(page.locator('#select-text-status')).toHaveText('Selected!')
  })

  test('records elementRect on selectText', async ({ page }) => {
    await selectTextLocator(page.locator('#select-text-input')).selectText({
      moveDuration: 50,
      selectDuration: 60,
    })

    const events = inputEvents().filter((e) => e.subType === 'selectText')
    const [event] = events
    expect(event!.elementRect).toBeDefined()
    expect(event!.elementRect!.width).toBeGreaterThan(0)
    expect(event!.elementRect!.height).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// dragTo
// ---------------------------------------------------------------------------

function draggableLocator(locator: Locator): {
  dragTo(
    target: Locator,
    opts?: {
      moveDuration?: number
      moveEasing?: string
      preDragPause?: number
      dragDuration?: number
      dragEasing?: string
      sourcePosition?: { x: number; y: number }
      targetPosition?: { x: number; y: number }
      force?: boolean
      timeout?: number
      trial?: boolean
    }
  ): Promise<void>
} {
  return locator as never
}

test.describe('dragTo instrumentation', () => {
  test('records a dragTo event with 2 mouseMoves, mouseDown and mouseUp', async ({
    page,
  }) => {
    await draggableLocator(page.locator('#drag-source')).dragTo(
      page.locator('#drop-target'),
      { moveDuration: 50, dragDuration: 50 }
    )

    const events = inputEvents().filter((e) => e.subType === 'dragTo')
    expect(events).toHaveLength(1)
    const [event] = events
    const moves = event!.events.filter((e) => e.type === 'mouseMove')
    expect(moves).toHaveLength(2)
    expect(event!.events.some((e) => e.type === 'mouseDown')).toBe(true)
    expect(event!.events.some((e) => e.type === 'mouseUp')).toBe(true)
  })

  test('actually drags the element', async ({ page }) => {
    await draggableLocator(page.locator('#drag-source')).dragTo(
      page.locator('#drop-target'),
      { moveDuration: 50, dragDuration: 50 }
    )
    await expect(page.locator('#drag-status')).toHaveText('Dropped!')
  })

  test('records elementRect on dragTo', async ({ page }) => {
    await draggableLocator(page.locator('#drag-source')).dragTo(
      page.locator('#drop-target'),
      { moveDuration: 50, dragDuration: 50 }
    )

    const events = inputEvents().filter((e) => e.subType === 'dragTo')
    const [event] = events
    expect(event!.elementRect).toBeDefined()
    expect(event!.elementRect!.width).toBeGreaterThan(0)
    expect(event!.elementRect!.height).toBeGreaterThan(0)
  })
})
