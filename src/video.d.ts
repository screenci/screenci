import type {
  TestType,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestDetails,
  TestInfo,
} from '@playwright/test'
import type { RecordOptions, RenderOptions, ScreenCIPage } from './types.js'
export { getDimensions } from './dimensions.js'
export declare const POST_VIDEO_PAUSE = 500
type VideoFixtureOptions = {
  recordOptions: RecordOptions
  renderOptions: RenderOptions | undefined
}
type VideoType = TestType<
  PlaywrightTestArgs &
    PlaywrightTestOptions &
    VideoFixtureOptions &
    PlaywrightWorkerArgs &
    PlaywrightWorkerOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>
type VideoArgs = Omit<PlaywrightTestArgs, 'page'> & {
  page: ScreenCIPage
} & PlaywrightTestOptions &
  VideoFixtureOptions &
  PlaywrightWorkerArgs &
  PlaywrightWorkerOptions
type VideoBody = (args: VideoArgs, testInfo: TestInfo) => void | Promise<void>
/** Conditional overloads shared by skip / fixme / fail */
type ConditionalOverloads = ((
  condition?: boolean,
  description?: string
) => void) &
  ((condition?: boolean, callback?: () => string) => void)
interface VideoCallSignatures {
  /**
   * Declares a ScreenCI video recording test.
   *
   * Tests automatically record browser interactions as video. The viewport is
   * configured based on `recordOptions.aspectRatio` and `recordOptions.quality`.
   *
   * @param title - Test title (used as the video filename)
   * @param body - Test body containing page interactions to record
   *
   * @example
   * ```ts
   * import { video } from 'screenci'
   *
   * video('Product demo', async ({ page }) => {
   *   await page.goto('https://example.com')
   *   await page.click('text=Get Started')
   *   // Video recorded at 16:9 1080p, 30fps (defaults)
   * })
   * ```
   *
   * @example
   * Configure video options:
   * ```ts
   * video.use({ recordOptions: { aspectRatio: '16:9', quality: '2160p', fps: 60 } })
   *
   * video('4K demo', async ({ page }) => {
   *   await page.goto('https://example.com')
   * })
   * ```
   */
  (title: string, body: VideoBody): void
  /**
   * Declares a ScreenCI video recording test with additional details.
   *
   * Tests automatically record browser interactions as video. The viewport is
   * configured based on `recordOptions.aspectRatio` and `recordOptions.quality`.
   *
   * @param title - Test title (used as the video filename)
   * @param details - Additional test configuration (tags, annotations, etc.)
   * @param body - Test body containing page interactions to record
   *
   * @example
   * Using tags:
   * ```ts
   * import { video } from 'screenci'
   *
   * video('Checkout flow', {
   *   tag: '@critical',
   * }, async ({ page }) => {
   *   await page.goto('https://example.com/checkout')
   * })
   * ```
   *
   * @example
   * Using annotations:
   * ```ts
   * video('Sign up', {
   *   annotation: { type: 'issue', description: 'https://github.com/...' },
   * }, async ({ page }) => {
   *   await page.goto('https://example.com/signup')
   * })
   * ```
   */
  (title: string, details: TestDetails, body: VideoBody): void
}
/**
 * Recursive interface so `.only`, `.skip`, `.fixme`, `.fail`, and `.slow`
 * all surface `page: ScreenCIPage` instead of the raw Playwright `page: Page`.
 *
 * Properties that don't receive per-test fixture args (`describe`, `beforeAll`,
 * `afterAll`, `use`, `extend`, `step`, `info`, `expect`, `setTimeout`) are
 * forwarded from `VideoType` unchanged.
 */
interface Video extends VideoCallSignatures {
  /** Run only this test. */
  only: Video
  /** Skip this test, with optional conditional overloads. */
  skip: Video & ConditionalOverloads
  /** Mark this test as fixme, with optional conditional overloads. */
  fixme: Video & ConditionalOverloads
  /** Mark this test as expected to fail, with optional conditional overloads. */
  fail: Video & ConditionalOverloads
  /** Mark this test as slow, with optional conditional overload. */
  slow: Video & ((condition?: boolean, description?: string) => void)
  /** Run a hook before each test in the current suite. */
  beforeEach(
    inner: (args: VideoArgs, testInfo: TestInfo) => Promise<void> | void
  ): void
  beforeEach(
    title: string,
    inner: (args: VideoArgs, testInfo: TestInfo) => Promise<void> | void
  ): void
  /** Run a hook after each test in the current suite. */
  afterEach(
    inner: (args: VideoArgs, testInfo: TestInfo) => Promise<void> | void
  ): void
  afterEach(
    title: string,
    inner: (args: VideoArgs, testInfo: TestInfo) => Promise<void> | void
  ): void
  describe: VideoType['describe']
  beforeAll: VideoType['beforeAll']
  afterAll: VideoType['afterAll']
  use: VideoType['use']
  extend: VideoType['extend']
  step: VideoType['step']
  info: VideoType['info']
  expect: VideoType['expect']
  setTimeout: VideoType['setTimeout']
}
/**
 * ScreenCI video recording test fixture.
 *
 * Extended Playwright test that automatically records browser interactions as video.
 * Configure recording options globally with `video.use()` or in your config file.
 *
 * @example
 * Basic usage:
 * ```ts
 * import { video, cue } from 'screenci'
 *
 * video('Tutorial', async ({ page }) => {
 *   await page.goto('https://example.com')
 *   cue('User navigates to homepage')
 *
 *   await page.click('text=Sign up')
 *   cue('Clicks sign up button')
 * })
 * ```
 */
export declare const video: Video
