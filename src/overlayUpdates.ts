import { invalidOptionError, ScreenciError } from './errors.js'
import type {
  BackgroundUpdateEvent,
  IEventRecorder,
  NarrationUpdateEvent,
  UpdateTransition,
} from './events.js'
import { getActiveHideRecorder } from './timelineBlock.js'
import { getScreenCIRuntimeContext } from './runtimeContext.js'
import { assetCandidatePaths, hashAssetFile } from './assetHash.js'
import type {
  Easing,
  NarrationCorner,
  NarrationFullScreenFit,
  NarrationPosition,
} from './types.js'
import { EASING_NAMES } from './types.js'

/**
 * Animation options shared by every mid-video overlay update. Omit `duration`
 * (or pass 0) for an instant change.
 */
export type OverlayTransitionOptions = {
  /** Animation length in milliseconds. */
  duration?: number
  /** Defaults to `'ease-in-out'`. */
  easing?: Easing
}

export type MoveNarrationOptions = OverlayTransitionOptions & {
  /**
   * Per-axis inset from the anchor corner as a fraction of the shorter output
   * side. Overrides the global `renderOptions.narration.padding` for the set
   * axis from this point on; an omitted axis keeps its current effective
   * value. Range [-1, 1]; negative pushes the tile past the edge. Corner
   * positions only.
   */
  padding?: { x?: number; y?: number }
  /**
   * Signed per-axis displacement from the exact output center, as a fraction
   * of the shorter output side. Range [-1, 1]. 'center' position only. The
   * offset persists for later 'center' moves until overridden.
   */
  offset?: { x?: number; y?: number }
  /**
   * How full-screen narration fits the frame: 'contain' letterboxes with
   * black bars, 'cover' fills the frame with slight cropping. Defaults to
   * 'contain'. 'full-screen' position only.
   */
  fit?: NarrationFullScreenFit
  /**
   * Tile size as a fraction of the shorter output side, (0, 1]. Set together
   * with the move to animate both in one synchronized transition. Not valid
   * with 'full-screen' (it always fills the frame).
   */
  size?: number
}

export type SetBackgroundInput =
  | { assetPath: string }
  | { backgroundCss: string }

const NARRATION_CORNERS: readonly NarrationCorner[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]

const NARRATION_POSITIONS: readonly NarrationPosition[] = [
  ...NARRATION_CORNERS,
  'center',
  'full-screen',
]

function assertFiniteInRange(
  api: string,
  option: string,
  value: number,
  min: number,
  max: number,
  expectation: string
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw invalidOptionError({ api, option, expectation, value })
  }
}

/** Validates and normalizes transition options. Returns undefined for instant. */
export function validateTransition(
  api: string,
  options: OverlayTransitionOptions | undefined
): UpdateTransition | undefined {
  if (options?.duration === undefined) {
    if (options?.easing !== undefined) {
      throw invalidOptionError({
        api,
        option: 'easing',
        expectation: 'easing requires duration to be set',
        value: options.easing,
      })
    }
    return undefined
  }
  const { duration } = options
  if (!Number.isInteger(duration) || duration < 0) {
    throw invalidOptionError({
      api,
      option: 'duration',
      expectation: 'an integer >= 0 (milliseconds)',
      value: duration,
    })
  }
  const easing = options.easing ?? 'ease-in-out'
  if (!EASING_NAMES.includes(easing)) {
    throw invalidOptionError({
      api,
      option: 'easing',
      expectation: `one of ${EASING_NAMES.join(', ')}`,
      value: easing,
    })
  }
  if (duration === 0) return undefined
  return { durationMs: duration, easing }
}

/** Validates a narration position name (exhaustive against {@link NarrationPosition}). */
export function validatePosition(
  api: string,
  position: NarrationPosition
): void {
  switch (position) {
    case 'top-left':
    case 'top-right':
    case 'bottom-left':
    case 'bottom-right':
    case 'center':
    case 'full-screen':
      return
    default: {
      const _: never = position
      throw invalidOptionError({
        api,
        option: 'position',
        expectation: `one of ${NARRATION_POSITIONS.join(', ')}`,
        value: _,
      })
    }
  }
}

/** Validates the payload of a `moveNarration()` call. */
export function validateMoveNarration(
  position: NarrationPosition,
  options: MoveNarrationOptions | undefined
): Omit<NarrationUpdateEvent, 'type' | 'timeMs'> {
  const api = 'moveNarration'
  validatePosition(api, position)
  const isCorner = (NARRATION_CORNERS as readonly string[]).includes(position)
  if (options?.padding !== undefined) {
    if (!isCorner) {
      throw invalidOptionError({
        api,
        option: 'padding',
        expectation: 'padding is only valid with corner positions',
        value: position,
      })
    }
    const { x, y } = options.padding
    if (x === undefined && y === undefined) {
      throw invalidOptionError({
        api,
        option: 'padding',
        expectation: 'at least one of padding.x / padding.y',
        value: options.padding,
      })
    }
    if (x !== undefined)
      assertFiniteInRange(api, 'padding.x', x, -1, 1, 'a number in [-1, 1]')
    if (y !== undefined)
      assertFiniteInRange(api, 'padding.y', y, -1, 1, 'a number in [-1, 1]')
  }
  if (options?.offset !== undefined) {
    if (position !== 'center') {
      throw invalidOptionError({
        api,
        option: 'offset',
        expectation: "offset is only valid with the 'center' position",
        value: position,
      })
    }
    const { x, y } = options.offset
    if (x === undefined && y === undefined) {
      throw invalidOptionError({
        api,
        option: 'offset',
        expectation: 'at least one of offset.x / offset.y',
        value: options.offset,
      })
    }
    if (x !== undefined)
      assertFiniteInRange(api, 'offset.x', x, -1, 1, 'a number in [-1, 1]')
    if (y !== undefined)
      assertFiniteInRange(api, 'offset.y', y, -1, 1, 'a number in [-1, 1]')
  }
  if (options?.fit !== undefined) {
    if (position !== 'full-screen') {
      throw invalidOptionError({
        api,
        option: 'fit',
        expectation: "fit is only valid with the 'full-screen' position",
        value: position,
      })
    }
    if (options.fit !== 'contain' && options.fit !== 'cover') {
      throw invalidOptionError({
        api,
        option: 'fit',
        expectation: "one of 'contain', 'cover'",
        value: options.fit,
      })
    }
  }
  if (options?.size !== undefined) {
    if (position === 'full-screen') {
      throw invalidOptionError({
        api,
        option: 'size',
        expectation:
          "size is not valid with 'full-screen' (it always fills the frame)",
        value: options.size,
      })
    }
    validateNarrationSize(api, options.size)
  }
  const transition = validateTransition(api, options)
  return {
    position,
    ...(options?.padding !== undefined && { padding: options.padding }),
    ...(options?.offset !== undefined && { offset: options.offset }),
    ...(options?.fit !== undefined && { fit: options.fit }),
    ...(options?.size !== undefined && { size: options.size }),
    ...(transition !== undefined && { transition }),
  }
}

/** Validates a narration tile size, (0, 1]. */
export function validateNarrationSize(api: string, size: number): void {
  if (!Number.isFinite(size) || size <= 0 || size > 1) {
    throw invalidOptionError({
      api,
      option: 'size',
      expectation: 'a number in (0, 1]',
      value: size,
    })
  }
}

/** Validates a recording size, [0, 1]. */
export function validateRecordingSize(api: string, size: number): void {
  if (!Number.isFinite(size) || size < 0 || size > 1) {
    throw invalidOptionError({
      api,
      option: 'size',
      expectation: 'a number in [0, 1]',
      value: size,
    })
  }
}

/** Validates the payload of a `setBackground()` call (path resolution excluded). */
export function validateSetBackground(
  background: SetBackgroundInput
): SetBackgroundInput {
  const api = 'setBackground'
  if ('backgroundCss' in background) {
    if (
      typeof background.backgroundCss !== 'string' ||
      background.backgroundCss.trim() === ''
    ) {
      throw invalidOptionError({
        api,
        option: 'backgroundCss',
        expectation: 'a non-empty CSS background string',
        value: background.backgroundCss,
      })
    }
    return { backgroundCss: background.backgroundCss }
  }
  if (typeof background.assetPath !== 'string' || background.assetPath === '') {
    throw invalidOptionError({
      api,
      option: 'assetPath',
      expectation: 'a non-empty file path',
      value: background.assetPath,
    })
  }
  return { assetPath: background.assetPath }
}

/**
 * Moves the narration (camera PIP) overlay to another position, optionally
 * with a new size, animated when a `duration` is given.
 *
 * Corner and 'center' moves slide positionally. 'full-screen' shows the
 * UNCROPPED narration source over the whole frame and never slides: it
 * appears in place, cross-fading over `duration` (the corner/center tile
 * fades out while the full-screen layer fades in). Any later move to a
 * corner or 'center' exits full screen the same way.
 *
 * @example
 * ```ts
 * await moveNarration('center', { offset: { x: 0.1 }, duration: 400 })
 * await moveNarration('full-screen', { fit: 'cover', duration: 300 })
 * await moveNarration('bottom-right', { duration: 300 }) // exits full screen
 * ```
 */
export async function moveNarration(
  position: NarrationPosition,
  options?: MoveNarrationOptions,
  recorder: IEventRecorder = getActiveHideRecorder()
): Promise<void> {
  recorder.addNarrationUpdate(validateMoveNarration(position, options))
}

/**
 * Resizes the narration (camera PIP) overlay mid-video, animated when a
 * `duration` is given. `size` is a fraction of the shorter output side.
 */
export async function resizeNarration(
  size: number,
  options?: OverlayTransitionOptions,
  recorder: IEventRecorder = getActiveHideRecorder()
): Promise<void> {
  validateNarrationSize('resizeNarration', size)
  const transition = validateTransition('resizeNarration', options)
  recorder.addNarrationUpdate({
    size,
    ...(transition !== undefined && { transition }),
  })
}

/**
 * Resizes the recording (browser capture) overlay mid-video, animated when a
 * `duration` is given. `size` uses the same 0-1 fraction as
 * `renderOptions.recording.size`.
 */
export async function resizeRecording(
  size: number,
  options?: OverlayTransitionOptions,
  recorder: IEventRecorder = getActiveHideRecorder()
): Promise<void> {
  validateRecordingSize('resizeRecording', size)
  const transition = validateTransition('resizeRecording', options)
  recorder.addRecordingUpdate({
    size,
    ...(transition !== undefined && { transition }),
  })
}

/**
 * Hides the recording (browser capture) overlay from this point on, with an
 * optional fade. Only the overlay disappears: the background, narration, and
 * the timeline keep running. To cut footage out of the video entirely, use
 * `hide()` instead.
 */
export async function hideRecording(
  options?: OverlayTransitionOptions,
  recorder: IEventRecorder = getActiveHideRecorder()
): Promise<void> {
  const transition = validateTransition('hideRecording', options)
  recorder.addRecordingUpdate({
    visible: false,
    ...(transition !== undefined && { transition }),
  })
}

/**
 * Shows the recording (browser capture) overlay after {@link hideRecording},
 * with an optional fade.
 */
export async function showRecording(
  options?: OverlayTransitionOptions,
  recorder: IEventRecorder = getActiveHideRecorder()
): Promise<void> {
  const transition = validateTransition('showRecording', options)
  recorder.addRecordingUpdate({
    visible: true,
    ...(transition !== undefined && { transition }),
  })
}

/**
 * Changes the video background mid-video. Pass a `duration` for a crossfade
 * to the new background; omit it for an instant cut.
 *
 * @example
 * ```ts
 * await setBackground({ backgroundCss: '#101014' }, { duration: 500 })
 * await setBackground({ assetPath: './assets/space.png' })
 * ```
 */
export async function setBackground(
  background: SetBackgroundInput,
  options?: OverlayTransitionOptions,
  recorder: IEventRecorder = getActiveHideRecorder()
): Promise<void> {
  const validated = validateSetBackground(background)
  const transition = validateTransition('setBackground', options)
  let resolved: BackgroundUpdateEvent['background']
  if ('assetPath' in validated) {
    const testFilePath = getScreenCIRuntimeContext().testFilePath
    const fileHash = await hashAssetFile(
      assetCandidatePaths(validated.assetPath, testFilePath)
    )
    if (fileHash === undefined) {
      throw new ScreenciError(
        `setBackground: background asset not found: ${validated.assetPath}`
      )
    }
    resolved = { assetPath: validated.assetPath, fileHash }
  } else {
    resolved = validated
  }
  recorder.addBackgroundUpdate({
    background: resolved,
    ...(transition !== undefined && { transition }),
  })
}

/** @internal Shared by narrationVisibility.ts for fade-capable hide/show. */
export function narrationVisibilityUpdate(
  api: 'hideNarration' | 'showNarration',
  visible: boolean,
  options: OverlayTransitionOptions | undefined,
  recorder: IEventRecorder
): void {
  const transition = validateTransition(api, options)
  if (transition === undefined) {
    // Instant hide/show keeps emitting the legacy events so existing renders
    // stay byte-identical.
    if (visible) {
      recorder.addNarrationShow()
    } else {
      recorder.addNarrationHide()
    }
    return
  }
  recorder.addNarrationUpdate({ visible, transition })
}
