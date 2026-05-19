import type {
  Page,
  BrowserContext,
  Browser,
  Locator,
  FrameLocator,
} from '@playwright/test'
import type { IEventRecorder } from './events.js'
export declare function setActiveClickRecorder(
  recorder: IEventRecorder | null
): void
export declare function instrumentFrameLocator(
  frameLocator: FrameLocator
): FrameLocator
export declare function instrumentLocator(locator: Locator): Locator
export declare function instrumentPage(page: Page): Promise<Page>
export declare function instrumentContext(
  context: BrowserContext
): BrowserContext
export declare function instrumentBrowser(browser: Browser): Browser
