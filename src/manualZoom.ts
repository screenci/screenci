import type { Locator, Page } from '@playwright/test'
import { DEFAULT_ZOOM_OPTIONS } from './defaults.js'
import { ScreenciError } from './errors.js'
import type { FocusChangeEvent } from './events.js'
import { isInsideHide } from './hide.js'
import { changeFocus, resolvePointFocusZoom } from './changeFocus.js'
import {
  getActiveAutoZoomRecorder,
  getActiveZoomPage,
  getAutoZoomState,
  setCurrentZoomViewport,
  setZoomMode,
} from './autoZoom.js'
import {
  buildZoomEvent,
  resolveAutoZoomOptions,
  resolveEffectiveDuration,
} from './zoom.js'
import type { AutoZoomOptions, Easing } from './types.js'
import { resolveRecordingTimingDuration } from './runtimeMode.js'
import {
  buildEditableMeta,
  editableIdentityKey,
  getLocatorDescription,
  type EditableMeta,
} from './editableDescriptor.js'
import { applyEditableOverride } from './editableRuntime.js'
import { nextEditablePosition } from './runtimeContext.js'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, resolveRecordingTimingDuration(ms))
  )
}

export type ZoomTargetPoint = { x: number; y: number }
export type ZoomTarget = Locator | ZoomTargetPoint

function isLocator(target: ZoomTarget): target is Locator {
  return typeof target === 'object' && target !== null && 'evaluate' in target
}

function assertManualZoomAllowed(api: 'zoomTo' | 'resetZoom'): void {
  const state = getAutoZoomState()
  if (state.insideAutoZoom || state.mode === 'auto') {
    throw new ScreenciError(`Cannot call ${api}() while autoZoom() is active`)
  }
}

async function resolveViewportSize(
  page: Page
): Promise<{ width: number; height: number }> {
  const viewport = page.viewportSize()
  if (viewport !== null) return viewport

  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
}

async function zoomToPoint(
  point: ZoomTargetPoint,
  options: AutoZoomOptions = {}
): Promise<FocusChangeEvent | undefined> {
  const page = getActiveZoomPage()
  if (page === null) {
    throw new ScreenciError(
      'zoomTo({ x, y }) requires an active ScreenCI page during recording'
    )
  }

  const state = getAutoZoomState()
  const viewportSize = await resolveViewportSize(page)
  const resolvedOptions = resolveAutoZoomOptions(state, options)
  const currentZoomEnd = state.currentZoomViewport?.end ?? {
    pointPx: { x: 0, y: 0 },
    size: {
      widthPx: viewportSize.width,
      heightPx: viewportSize.height,
    },
  }
  const pointZoom = resolvePointFocusZoom({
    point,
    viewportSize,
    amount: resolvedOptions.amount,
    centering: resolvedOptions.centering,
    currentZoomEnd,
  })
  const zoomTarget = pointZoom.zoomTarget

  const isZoomOut =
    pointZoom.targetViewport.width >= currentZoomEnd.size.widthPx
  const effectiveDuration = resolveEffectiveDuration(resolvedOptions, isZoomOut)

  const focusChangeStartMs = Date.now()
  const zoomStartMs = Date.now()
  if (effectiveDuration > 0) {
    await sleep(effectiveDuration)
  }
  const zoomEndMs = Date.now()
  const focusChangeEndMs = Date.now()

  const zoomEvent = buildZoomEvent({
    target: zoomTarget,
    currentZoomEnd,
    zoomTiming:
      zoomTarget !== undefined
        ? {
            startMs: zoomStartMs,
            endMs: zoomEndMs,
            easing: resolvedOptions.easing,
          }
        : undefined,
  })

  const fullViewportEnd = {
    pointPx: { x: 0, y: 0 },
    size: {
      widthPx: viewportSize.width,
      heightPx: viewportSize.height,
    },
  }

  setCurrentZoomViewport({
    focusPoint: point,
    end: zoomTarget?.end ?? fullViewportEnd,
    viewportSize,
    optimalOffset: zoomTarget?.optimalOffset ?? { x: 0, y: 0 },
  })

  if (zoomTarget !== undefined || state.mode === 'manual') {
    setZoomMode('manual')
  } else {
    setZoomMode('idle')
  }

  return {
    type: 'focusChange',
    startMs: focusChangeStartMs,
    endMs: focusChangeEndMs,
    x: point.x,
    y: point.y,
    ...(zoomEvent !== undefined ? { zoom: zoomEvent } : {}),
  }
}

/**
 * Editable metadata for a `zoomTo` call so manual zooms appear on the web
 * editor's camera row. Explicit code options become `lockedFields` (edits
 * still apply, with a shadow warning); unset fields are recorded as `null`
 * so the editor knows they exist and may set them.
 */
function buildZoomToEditableMeta(
  target: ZoomTarget,
  options: AutoZoomOptions
): EditableMeta | undefined {
  const matcher = isLocator(target)
    ? getLocatorDescription(target)
    : `point(${target.x}, ${target.y})`
  const identity = {
    kind: 'input' as const,
    subKind: 'focusChange',
    ...(matcher !== undefined && { matcher }),
  }
  const editableOptionKeys = [
    'easing',
    'duration',
    'amount',
    'centering',
  ] as const
  return buildEditableMeta({
    ...identity,
    schemaKind: 'autoZoom',
    locked: editableOptionKeys.some((key) => options[key] !== undefined),
    lockedFields: editableOptionKeys.filter(
      (key) => options[key] !== undefined
    ),
    defaults: {
      easing: options.easing ?? null,
      duration: options.duration ?? null,
      amount: options.amount ?? null,
      centering: options.centering ?? null,
    },
    position: nextEditablePosition(editableIdentityKey(identity)),
  })
}

/** Web-editable zoom option values merged over the code-supplied ones. */
function resolveZoomToOptions(
  editable: EditableMeta | undefined,
  options: AutoZoomOptions
): AutoZoomOptions {
  if (editable === undefined) return options
  const eff = applyEditableOverride(editable)
  return {
    ...options,
    ...(typeof eff.easing === 'string' && { easing: eff.easing as Easing }),
    ...(typeof eff.duration === 'number' && { duration: eff.duration }),
    ...(typeof eff.amount === 'number' && { amount: eff.amount }),
    ...(typeof eff.centering === 'number' && { centering: eff.centering }),
  }
}

export async function zoomTo(
  target: ZoomTarget,
  options: AutoZoomOptions = {}
): Promise<void> {
  assertManualZoomAllowed('zoomTo')

  const editable = buildZoomToEditableMeta(target, options)
  const effectiveOptions = resolveZoomToOptions(editable, options)

  const recorder = getActiveAutoZoomRecorder()
  if (isLocator(target)) {
    const previousMode = getAutoZoomState().mode
    const result = await changeFocus(target, effectiveOptions, undefined, true)
    setZoomMode(
      result.zoom !== undefined || previousMode === 'manual' ? 'manual' : 'idle'
    )
    if (!isInsideHide()) {
      recorder.addInput('focusChange', result.elementRect, [result], editable)
    }
    return
  }

  const result = await zoomToPoint(target, effectiveOptions)
  if (result !== undefined && !isInsideHide()) {
    recorder.addInput('focusChange', undefined, [result], editable)
  }
}

export async function resetZoom(options: AutoZoomOptions = {}): Promise<void> {
  assertManualZoomAllowed('resetZoom')

  const state = getAutoZoomState()
  const viewport = state.currentZoomViewport
  if (state.mode !== 'manual' || viewport === null) {
    return
  }

  const recorder = getActiveAutoZoomRecorder()
  // Web-editable like zoomTo: identity is the fixed 'resetZoom' matcher; the
  // editable fields are the zoom-out easing and duration.
  const identity = {
    kind: 'input' as const,
    subKind: 'focusChange',
    matcher: 'resetZoom',
  }
  const editable = buildEditableMeta({
    ...identity,
    schemaKind: 'autoZoom',
    locked:
      options.easing !== undefined || options.zoomOutDuration !== undefined,
    lockedFields: [
      ...(options.easing !== undefined ? ['easing'] : []),
      ...(options.zoomOutDuration !== undefined ? ['duration'] : []),
    ],
    defaults: {
      easing: options.easing ?? null,
      duration: options.zoomOutDuration ?? null,
    },
    position: nextEditablePosition(editableIdentityKey(identity)),
  })
  const eff = applyEditableOverride(editable)
  const effectiveOptions: AutoZoomOptions = {
    ...options,
    ...(typeof eff.easing === 'string' && { easing: eff.easing as Easing }),
    ...(typeof eff.duration === 'number' && {
      zoomOutDuration: eff.duration,
    }),
  }
  const resolvedOptions = resolveAutoZoomOptions(state, effectiveOptions)
  const fullViewportEnd = {
    pointPx: { x: 0, y: 0 },
    size: {
      widthPx: viewport.viewportSize.width,
      heightPx: viewport.viewportSize.height,
    },
  }
  const resetDuration = resolvedOptions.zoomOutDuration
  const focusChangeStartMs = Date.now()
  const zoomStartMs = Date.now()
  if (resetDuration > 0) {
    await sleep(resetDuration)
  }
  const zoomEndMs = Date.now()
  const focusChangeEndMs = Date.now()

  const result: FocusChangeEvent = {
    type: 'focusChange',
    startMs: focusChangeStartMs,
    endMs: focusChangeEndMs,
    x: viewport.focusPoint.x,
    y: viewport.focusPoint.y,
    zoom: {
      startMs: zoomStartMs,
      endMs: zoomEndMs,
      easing: resolvedOptions.easing ?? DEFAULT_ZOOM_OPTIONS.easing,
      end: fullViewportEnd,
    },
    ...(viewport.elementRect !== undefined
      ? { elementRect: viewport.elementRect }
      : {}),
  }

  setCurrentZoomViewport({
    focusPoint: viewport.focusPoint,
    end: fullViewportEnd,
    viewportSize: viewport.viewportSize,
    optimalOffset: { x: 0, y: 0 },
    ...(viewport.elementRect !== undefined
      ? { elementRect: viewport.elementRect }
      : {}),
  })
  setZoomMode('idle')

  if (!isInsideHide()) {
    recorder.addInput('focusChange', viewport.elementRect, [result], editable)
  }
}
