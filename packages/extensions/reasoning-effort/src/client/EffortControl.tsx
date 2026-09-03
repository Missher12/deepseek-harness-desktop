import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ModelDirectory, ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconCheckOutline16, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import chibiRunnerSprite from '../../assets/chibi-runner-strip.png'
import { drawRadiation, type RadiationState } from './draw-radiation.ts'
import { usePopupPlacement } from './use-popup-placement.ts'
import css from './EffortControl.module.css'

/** Browser bootstrap written by this plugin's Host half. */
interface PreferenceBootstrap {
  readonly preferencePath: string
  readonly capabilityHeader: string
  readonly capability: string
}

declare global {
  interface Window {
    __DSH_REASONING_EFFORT__?: PreferenceBootstrap
  }
}

/** Injected session face; addressed subagents receive the unavailable branch. */
export type EffortControlInjected =
  | { readonly available: false; readonly controller: null }
  | { readonly available: true; readonly controller: ModelDirectory; readonly sessionId: SessionId }

type Translate = PropsLocale<'reasoningEffort'>['t']

interface EffortLevel {
  readonly id: string
  readonly name: string
  readonly description?: string
}

type ModelCatalogModel = ModelDirectoryState['groups'][number]['models'][number]

/** Stable positive-effort ladder shown for every adjustable model. */
const DISPLAY_LEVELS: readonly EffortLevel[] = [
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
  { id: 'xhigh', name: 'XHigh' },
  { id: 'max', name: 'Max' },
  { id: 'ultra', name: 'Ultra' },
]

const DISPLAY_RANK = new Map(DISPLAY_LEVELS.map((level, index) => [level.id, index]))

const EXPECTED_PREFERENCE_PATH = '/plugins/dsh-reasoning-effort/preference'
const EXPECTED_CAPABILITY_HEADER = 'x-dsh-reasoning-effort-capability'

function currentModel(state: ModelDirectoryState): ModelCatalogModel | undefined {
  if (state.current === null) return undefined
  return state.groups
    .find(group => group.id === state.current?.provider)
    ?.models.find(model => model.id === state.current?.model)
}

/** Host-advertised levels the ladder may target, absent for off-only models. */
function modelEffortLevels(state: ModelDirectoryState): readonly EffortLevel[] {
  const levels = currentModel(state)?.reasoning?.efforts ?? []
  return levels.some(level => level.id !== 'off') ? levels : []
}

/** Six stable visual levels, hidden only when the model offers no positive effort. */
export function sliderLevels(state: ModelDirectoryState): readonly EffortLevel[] {
  return modelEffortLevels(state).length === 0 ? [] : DISPLAY_LEVELS
}

function clampIndex(value: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round(value)))
}

function effortIndex(levels: readonly EffortLevel[], effort: string | undefined): number {
  return levels.findIndex(level => level.id === effort)
}

/** Map one fixed visual step to a real effort the exact model advertises. */
function modelEffortAt(levels: readonly EffortLevel[], visualIndex: number): EffortLevel | undefined {
  if (levels.length === 0) return undefined
  const target = clampIndex(visualIndex, DISPLAY_LEVELS.length)
  const ranked = levels.flatMap((level, order) => {
    const rank = level.id === 'off' || level.id === 'minimal' ? 0 : DISPLAY_RANK.get(level.id)
    return rank === undefined ? [] : [{ level, rank, order }]
  })
  if (ranked.length > 0) {
    // Prefer the strongest supported level not exceeding the visual target.
    // When none exists (for example a High-only model at Low), use the model's
    // weakest positive level. Stable Host order breaks equal-rank ties so Low
    // wins over Minimal when both are advertised.
    return ranked
      .filter(item => item.rank <= target)
      .sort((a, b) => b.rank - a.rank || b.order - a.order)[0]?.level
      ?? ranked.sort((a, b) => a.rank - b.rank || b.order - a.order)[0]?.level
  }
  // Adapter-defined opaque IDs have no shared vocabulary. Preserve their
  // advertised escalation order and spread it across the six visual stops.
  const at = Math.round(target * (levels.length - 1) / (DISPLAY_LEVELS.length - 1))
  return levels[at]
}

/** Visual stop representing an accepted real effort. */
function visualIndexForEffort(levels: readonly EffortLevel[], effort: string | undefined): number {
  const direct = effort === 'off' || effort === 'minimal' ? 0 : DISPLAY_RANK.get(effort ?? '')
  if (direct !== undefined) return direct
  const actual = effortIndex(levels, effort)
  if (actual < 0 || levels.length < 2) return 0
  return Math.round(actual * (DISPLAY_LEVELS.length - 1) / (levels.length - 1))
}

/** Current -> Host default -> middle, expressed on the fixed visual ladder. */
export function effectiveEffortIndex(
  levels: readonly EffortLevel[],
  state: ModelDirectoryState,
): number {
  const actual = modelEffortLevels(state)
  const current = effortIndex(actual, state.current?.reasoningEffort)
  if (current >= 0) return visualIndexForEffort(actual, actual[current]?.id)
  const fallback = effortIndex(actual, currentModel(state)?.reasoning?.defaultEffort)
  if (fallback >= 0) return visualIndexForEffort(actual, actual[fallback]?.id)
  return Math.floor((levels.length - 1) / 2)
}

function resolvedEffortIndex(
  visualLevels: readonly EffortLevel[],
  actualLevels: readonly EffortLevel[],
  state: ModelDirectoryState,
  acceptedEffortId: string | null,
  preferredVisualIndex: number | null,
): number {
  if (preferredVisualIndex !== null
    && modelEffortAt(actualLevels, preferredVisualIndex)?.id === acceptedEffortId) {
    return preferredVisualIndex
  }
  const accepted = effortIndex(actualLevels, acceptedEffortId ?? undefined)
  return accepted >= 0
    ? visualIndexForEffort(actualLevels, actualLevels[accepted]?.id)
    : effectiveEffortIndex(visualLevels, state)
}

function validBootstrap(value: unknown): PreferenceBootstrap | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<PreferenceBootstrap>
  if (candidate.preferencePath !== EXPECTED_PREFERENCE_PATH
    || candidate.capabilityHeader !== EXPECTED_CAPABILITY_HEADER
    || typeof candidate.capability !== 'string'
    || candidate.capability === '') return undefined
  return candidate as PreferenceBootstrap
}

interface ClientPreference {
  readonly chibiThumb: boolean
  readonly visualEfforts: Readonly<Record<string, number>>
}

const DEFAULT_CLIENT_PREFERENCE: ClientPreference = { chibiThumb: false, visualEfforts: {} }

function readClientPreference(value: unknown): ClientPreference | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 2
    || typeof record.chibiThumb !== 'boolean'
    || typeof record.visualEfforts !== 'object'
    || record.visualEfforts === null
    || Array.isArray(record.visualEfforts)) return undefined
  if (Object.keys(record.visualEfforts).length > 64) return undefined
  const visualEfforts: Record<string, number> = {}
  for (const [route, index] of Object.entries(record.visualEfforts)) {
    if (route.length === 0 || route.length > 512 || !Number.isInteger(index) || Number(index) < 0 || Number(index) > 5) {
      return undefined
    }
    visualEfforts[route] = Number(index)
  }
  return { chibiThumb: record.chibiThumb, visualEfforts }
}

/** Profile-backed plugin preferences; absent/corrupt data always fails closed. */
function useReasoningEffortPreference(): {
  readonly value: ClientPreference
  readonly enabled: boolean
  readonly pending: boolean
  readonly toggle: () => Promise<boolean>
  readonly persistVisual: (route: string, index: number) => Promise<boolean>
} {
  const [value, setValue] = useState<ClientPreference>(DEFAULT_CLIENT_PREFERENCE)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const bootstrap = validBootstrap(window.__DSH_REASONING_EFFORT__)
    if (bootstrap === undefined) return
    const controller = new AbortController()
    void fetch(bootstrap.preferencePath, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: { [bootstrap.capabilityHeader]: bootstrap.capability },
    }).then(async (response) => {
      if (!response.ok) return
      const accepted = readClientPreference(await response.json() as unknown)
      if (accepted !== undefined) setValue(accepted)
    }).catch(() => { /* the fail-closed default remains false */ })
    return () => { controller.abort() }
  }, [])

  const toggle = useCallback(async (): Promise<boolean> => {
    const bootstrap = validBootstrap(window.__DSH_REASONING_EFFORT__)
    if (bootstrap === undefined || pending) return false
    const next = !value.chibiThumb
    setPending(true)
    try {
      const response = await fetch(bootstrap.preferencePath, {
        method: 'PUT',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          [bootstrap.capabilityHeader]: bootstrap.capability,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ chibiThumb: next }),
      })
      if (!response.ok) return false
      const accepted = readClientPreference(await response.json() as unknown)
      if (accepted?.chibiThumb !== next) return false
      setValue(accepted)
      return true
    } catch {
      return false
    } finally {
      setPending(false)
    }
  }, [pending, value.chibiThumb])

  const persistVisual = useCallback(async (route: string, index: number): Promise<boolean> => {
    const bootstrap = validBootstrap(window.__DSH_REASONING_EFFORT__)
    // Source/unit environments do not have a Host bridge. Keep the immediate
    // visual choice without presenting a false persistence failure there.
    if (bootstrap === undefined) return true
    try {
      const response = await fetch(bootstrap.preferencePath, {
        method: 'PUT',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          [bootstrap.capabilityHeader]: bootstrap.capability,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ visualEffort: { route, index } }),
      })
      if (!response.ok) return false
      const accepted = readClientPreference(await response.json() as unknown)
      if (accepted?.visualEfforts[route] !== index) return false
      setValue(accepted)
      return true
    } catch {
      return false
    }
  }, [])

  return { value, enabled: value.chibiThumb, pending, toggle, persistVisual }
}

/** Props for the accessible effort range and its attributed Canvas layer. */
export interface EffortSliderProps {
  readonly levels: readonly EffortLevel[]
  readonly acceptedIndex: number
  readonly previewIndex: number
  /** Strongest exact effort the model advertises. */
  readonly capName?: string
  readonly disabled: boolean
  readonly dragging: boolean
  readonly chibiThumb: boolean
  readonly error: string | null
  readonly t: Translate
  readonly onPreview: (index: number) => void
  readonly onCommit: (index: number) => void
  readonly onDraggingChange: (dragging: boolean) => void
}

/** Host-advertised range with pointer/touch/keyboard parity and static reduced-motion rendering. */
export function EffortSlider({
  levels,
  acceptedIndex,
  previewIndex,
  capName,
  disabled,
  dragging,
  chibiThumb,
  error,
  t,
  onPreview,
  onCommit,
  onDraggingChange,
}: EffortSliderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const activePointer = useRef<number | null>(null)
  const activeTouch = useRef(false)
  const radiation = useRef<RadiationState>({ progress: 0, dragging: false })
  const redraw = useRef<(() => void) | null>(null)
  const count = levels.length
  const selected = levels[clampIndex(previewIndex, count)]
  const selectedName = selected?.name ?? ''
  const progress = count < 2 ? 0 : previewIndex / (count - 1)

  useEffect(() => {
    radiation.current = { progress, dragging }
    redraw.current?.()
  }, [dragging, progress])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let width = 1
    let height = 1
    let frame: number | null = null

    const resize = (): void => {
      const bounds = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      canvas.width = Math.max(1, Math.round(width * ratio))
      canvas.height = Math.max(1, Math.round(height * ratio))
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    const draw = (time = performance.now()): void => {
      drawRadiation(context, width, height, time, radiation.current)
    }
    const loop = (time: number): void => {
      draw(time)
      frame = window.requestAnimationFrame(loop)
    }
    const stopLoop = (): void => {
      if (frame === null) return
      window.cancelAnimationFrame(frame)
      frame = null
    }
    const syncMotion = (): void => {
      stopLoop()
      draw()
      if (!media.matches) frame = window.requestAnimationFrame(loop)
    }
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => { resize(); draw() })
    const themeObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => { draw() })
    resizeObserver?.observe(canvas)
    themeObserver?.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    media.addEventListener('change', syncMotion)
    redraw.current = () => { if (media.matches) draw() }
    resize()
    syncMotion()
    return () => {
      stopLoop()
      resizeObserver?.disconnect()
      themeObserver?.disconnect()
      media.removeEventListener('change', syncMotion)
      redraw.current = null
    }
  }, [])

  const rawFromX = useCallback((clientX: number): number => {
    const bounds = inputRef.current?.getBoundingClientRect()
    if (bounds === undefined || bounds.width <= 0 || count < 2) return previewIndex
    return Math.max(0, Math.min(count - 1, (clientX - bounds.left) / bounds.width * (count - 1)))
  }, [count, previewIndex])

  const finishPointer = useCallback((pointerId: number, clientX: number): void => {
    if (activePointer.current !== pointerId) return
    activePointer.current = null
    const target = rawFromX(clientX)
    onPreview(target)
    onDraggingChange(false)
    onCommit(target)
  }, [onCommit, onDraggingChange, onPreview, rawFromX])

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      if (activePointer.current !== event.pointerId) return
      onPreview(rawFromX(event.clientX))
    }
    const up = (event: PointerEvent): void => { finishPointer(event.pointerId, event.clientX) }
    const cancel = (event: PointerEvent): void => {
      if (activePointer.current !== event.pointerId) return
      activePointer.current = null
      onPreview(acceptedIndex)
      onDraggingChange(false)
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', cancel, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', cancel, true)
    }
  }, [acceptedIndex, finishPointer, onDraggingChange, onPreview, rawFromX])

  const startPointer = (event: ReactPointerEvent<HTMLInputElement>): void => {
    event.preventDefault()
    event.currentTarget.focus()
    activePointer.current = event.pointerId
    onDraggingChange(true)
    onPreview(rawFromX(event.clientX))
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* window listeners remain authoritative */ }
  }

  const updateTouch = (event: ReactTouchEvent<HTMLInputElement>): void => {
    const touch = event.touches[0]
    if (touch !== undefined) onPreview(rawFromX(touch.clientX))
  }

  const keyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    const current = clampIndex(Number(event.currentTarget.value), count)
    let next: number | undefined
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown') next = current - 1
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp') next = current + 1
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = count - 1
    if (next === undefined) return
    event.preventDefault()
    const clamped = clampIndex(next, count)
    onPreview(clamped)
    onCommit(clamped)
  }

  const style = { '--reasoning-effort-progress': `${progress * 100}%` } as CSSProperties
  return (
    <div className={css.effortGroup} role="group" aria-label={t('effort.title')}>
      <div className={css.effortHeader}>
        <span>{t('effort.title')}</span>
        <span className={css.effortValue}>{selectedName}</span>
      </div>
      <div className={css.slider} style={style} data-dragging={dragging || undefined}>
        <div className={css.track} aria-hidden="true" />
        <canvas ref={canvasRef} className={css.canvas} aria-hidden="true" />
        <input
          ref={inputRef}
          data-effort-first-control
          className={css.range}
          type="range"
          min={0}
          max={count - 1}
          step={1}
          value={previewIndex}
          disabled={disabled}
          aria-label={t('effort.aria')}
          aria-valuetext={selectedName}
          onChange={(event) => { onPreview(Number(event.currentTarget.value)) }}
          onKeyDown={keyDown}
          onPointerDown={startPointer}
          onTouchStart={(event) => {
            activeTouch.current = true
            onDraggingChange(true)
            updateTouch(event)
          }}
          onTouchMove={updateTouch}
          onTouchEnd={(event) => {
            if (!activeTouch.current) return
            activeTouch.current = false
            const touch = event.changedTouches[0]
            const target = touch === undefined ? previewIndex : rawFromX(touch.clientX)
            onPreview(target)
            onDraggingChange(false)
            onCommit(target)
          }}
          onTouchCancel={() => {
            activeTouch.current = false
            onPreview(acceptedIndex)
            onDraggingChange(false)
          }}
        />
        <span
          className={`${css.knob}${chibiThumb ? ` ${css.chibi}` : ''}`}
          style={chibiThumb ? { backgroundImage: `url(${chibiRunnerSprite})` } : undefined}
          aria-hidden="true"
        />
      </div>
      {capName === undefined ? null : <div className={css.effortCap}>{t('effort.cap', { effort: capName })}</div>}
      {error === null ? null : <div className={css.error} role="alert">{error}</div>}
    </div>
  )
}

interface ActiveEffortControlProps {
  readonly locked: boolean
  readonly controller: ModelDirectory
  readonly sessionId: SessionId
  readonly t: Translate
}

/** Active session model/effort control. */
function ActiveEffortControl({ locked, controller, sessionId, t }: ActiveEffortControlProps) {
  const state = useSyncExternalStore(
    notify => controller.store.subscribe(notify),
    () => controller.store.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [popup, setPopup] = useState<HTMLDivElement | null>(null)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const acceptedEffortIdRef = useRef<string | null>(null)
  const preferredVisualIndexRef = useRef<number | null>(null)
  const routeRef = useRef<string | null>(null)
  const committingRef = useRef(false)
  const pendingLoadRef = useRef<{ controller: ModelDirectory; promise: Promise<void> } | null>(null)
  const successfulLoadRef = useRef<{ controller: ModelDirectory; at: number } | null>(null)
  const id = useId()
  const preference = useReasoningEffortPreference()
  const choice = currentModel(state)
  const actualLevels = useMemo(
    () => {
      const advertised = choice?.reasoning?.efforts ?? []
      return advertised.some(level => level.id !== 'off') ? advertised : []
    },
    [choice?.reasoning?.efforts],
  )
  const levels = actualLevels.length === 0 ? [] : DISPLAY_LEVELS
  const placement = usePopupPlacement({ anchor, popup, open, preferred: 'below' })
  const effectiveIndex = levels.length > 0 ? effectiveEffortIndex(levels, state) : -1
  const selectedActual = actualLevels.find(level => level.id === state.current?.reasoningEffort)
    ?? actualLevels.find(level => level.id === choice?.reasoning?.defaultEffort)
  const route = state.current === null
    ? null
    : JSON.stringify([sessionId, state.current.provider, state.current.model])
  const storedVisualIndex = route === null ? null : preference.value.visualEfforts[route] ?? null
  const preferredVisualIndex = routeRef.current === route
    ? preferredVisualIndexRef.current ?? storedVisualIndex
    : storedVisualIndex
  const acceptedEffortId = selectedActual?.id
    ?? modelEffortAt(actualLevels, effectiveIndex)?.id
    ?? null
  const acceptedIndex = levels.length === 0
    ? -1
    : resolvedEffortIndex(
      levels,
      actualLevels,
      state,
      acceptedEffortId,
      preferredVisualIndex,
    )
  // The label reflects the stable six-step UI selection. Providers still
  // receive the exact supported level mapped by modelEffortAt; a High-only
  // model therefore keeps "Ultra" visible after Ultra safely dispatches High.
  const effortName = acceptedIndex < 0 ? undefined : levels[acceptedIndex]?.name
  const modelName = choice?.name ?? state.current?.model ?? t('trigger.fallback')
  const busy = committing || state.status === 'selecting'
  const modelCap = actualLevels.at(-1)
  const preferenceAvailable = validBootstrap(window.__DSH_REASONING_EFFORT__) !== undefined

  const bindTrigger = useCallback((node: HTMLButtonElement | null): void => {
    triggerRef.current = node
    setAnchor(node)
  }, [])

  useEffect(() => {
    if (levels.length === 0 || committingRef.current || dragging) return
    if (routeRef.current !== route) {
      routeRef.current = route
      preferredVisualIndexRef.current = storedVisualIndex
    } else if (preferredVisualIndexRef.current === null && storedVisualIndex !== null) {
      preferredVisualIndexRef.current = storedVisualIndex
    }
    const next = resolvedEffortIndex(
      levels,
      actualLevels,
      state,
      acceptedEffortId,
      preferredVisualIndexRef.current,
    )
    acceptedEffortIdRef.current = acceptedEffortId
    setPreviewIndex(next)
    setError(null)
  }, [acceptedEffortId, actualLevels, dragging, levels, route, state, storedVisualIndex])

  const close = useCallback((restoreFocus = false): void => {
    setOpen(false)
    setDragging(false)
    if (restoreFocus) {
      queueMicrotask(() => {
        triggerRef.current?.focus()
      })
    }
  }, [])

  const refresh = useCallback(async (freshForMs = 0): Promise<void> => {
    const pending = pendingLoadRef.current
    if (pending?.controller === controller) {
      await pending.promise
      return
    }
    const successful = successfulLoadRef.current
    if (successful?.controller === controller && performance.now() - successful.at <= freshForMs) return
    setError(null)
    const promise = controller.load()
      .then(() => { successfulLoadRef.current = { controller, at: performance.now() } })
      .catch((cause: unknown) => {
        setError(t('error.action', { message: cause instanceof Error ? cause.message : String(cause) }))
      })
      .finally(() => {
        if (pendingLoadRef.current?.promise === promise) pendingLoadRef.current = null
      })
    pendingLoadRef.current = { controller, promise }
    await promise
  }, [controller, t])

  useEffect(() => {
    if (state.status === 'idle') void refresh()
  }, [refresh, state.status])

  const show = (): void => {
    setOpen(true)
    void refresh(750)
  }

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (anchor?.contains(target) || popup?.contains(target)) return
      close()
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close(true)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [anchor, close, open, popup])

  const commitEffort = useCallback(async (rawIndex: number): Promise<void> => {
    if (committingRef.current || state.current === null || levels.length === 0) return
    const index = clampIndex(rawIndex, levels.length)
    const target = modelEffortAt(actualLevels, index)
    if (target === undefined) return
    const route = { provider: state.current.provider, model: state.current.model }
    const previousId = acceptedEffortIdRef.current ?? modelEffortAt(actualLevels, acceptedIndex)?.id ?? null
    let rollbackState = state
    let rollbackVisualLevels = levels
    let rollbackActualLevels: readonly EffortLevel[] = actualLevels
    committingRef.current = true
    setCommitting(true)
    setDragging(false)
    setPreviewIndex(index)
    setError(null)
    try {
      const freshState = await controller.load()
      const available = sliderLevels(freshState)
      const freshActual = modelEffortLevels(freshState)
      rollbackState = freshState
      rollbackVisualLevels = available
      rollbackActualLevels = freshActual
      if (freshState.current === null
        || freshState.current.provider !== route.provider
        || freshState.current.model !== route.model) {
        throw new Error(t('error.staleRoute'))
      }
      if (!freshActual.some(level => level.id === target.id)) throw new Error(t('error.staleEffort'))
      await controller.select({ ...route, reasoningEffort: target.id })
      acceptedEffortIdRef.current = target.id
      preferredVisualIndexRef.current = index
      setPreviewIndex(index)
      const durableRoute = JSON.stringify([sessionId, route.provider, route.model])
      if (!await preference.persistVisual(durableRoute, index)) {
        setError(t('effort.persistFailed'))
      }
    } catch (cause) {
      const rollback = resolvedEffortIndex(
        rollbackVisualLevels,
        rollbackActualLevels,
        rollbackState,
        previousId,
        preferredVisualIndexRef.current,
      )
      acceptedEffortIdRef.current = modelEffortAt(rollbackActualLevels, rollback)?.id ?? null
      setPreviewIndex(rollback)
      setError(t('error.action', { message: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      committingRef.current = false
      setCommitting(false)
    }
  }, [acceptedIndex, actualLevels, controller, levels, preference, sessionId, state, t])

  const chooseModel = async (
    provider: string,
    model: string,
    defaultEffort: string | undefined,
  ): Promise<void> => {
    if (state.current?.provider === provider && state.current.model === model) return
    setError(null)
    try {
      const selection: ModelSelection = {
        provider,
        model,
        ...(defaultEffort === undefined ? {} : { reasoningEffort: defaultEffort }),
      }
      await controller.select(selection)
      close(true)
    } catch (cause) {
      setError(t('error.action', { message: cause instanceof Error ? cause.message : String(cause) }))
    }
  }

  const triggerLabel = t('trigger.aria', {
    model: modelName,
    effort: effortName ?? currentModel(state)?.reasoning?.defaultEffort ?? '—',
  })
  const popupStyle: CSSProperties = placement === null
    ? {
      position: 'fixed',
      visibility: 'hidden',
      boxSizing: 'border-box',
    }
    : {
      position: 'fixed',
      top: placement.top,
      left: placement.left,
      maxHeight: placement.maxHeight,
      maxWidth: placement.maxWidth,
      boxSizing: 'border-box',
    }

  return (
    <div className={css.root}>
      <button
        ref={bindTrigger}
        type="button"
        className={css.trigger}
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-popup` : undefined}
        disabled={locked}
        title={effortName === undefined ? modelName : `${modelName} · ${effortName}`}
        onClick={() => { if (open) close(); else show() }}
        onKeyDown={(event) => {
          if (!open || event.key !== 'Tab' || event.shiftKey) return
          const first = popup?.querySelector<HTMLElement>('[data-effort-first-control], button, input')
          if (first === null || first === undefined) return
          event.preventDefault()
          first.focus()
        }}
      >
        <span className={css.triggerModel}>{modelName}</span>
        {effortName === undefined ? null : <span className={css.triggerEffort}>{effortName}</span>}
        <IconChevronDownOutline14 className={`${css.chevron}${open ? ` ${css.chevronOpen}` : ''}`} />
      </button>

      {open && createPortal(
        <div
          ref={setPopup}
          id={`${id}-popup`}
          className={css.popup}
          style={popupStyle}
          role="dialog"
          aria-label={t('popup.aria')}
          aria-busy={state.status === 'loading' || busy}
          data-side={placement?.side}
          onKeyDown={(event) => {
            if (event.key !== 'Tab' || !event.shiftKey) return
            const first = popup?.querySelector<HTMLElement>('[data-effort-first-control], button, input')
            if (document.activeElement !== first) return
            event.preventDefault()
            triggerRef.current?.focus()
          }}
        >
          <div className={css.effortPane}>
            {levels.length > 0
              ? <EffortSlider
                levels={levels}
                acceptedIndex={acceptedIndex}
                previewIndex={previewIndex}
                {...modelCap === undefined ? {} : { capName: modelCap.name }}
                disabled={busy}
                dragging={dragging}
                chibiThumb={preference.enabled}
                error={error}
                t={t}
                onPreview={setPreviewIndex}
                onCommit={(index) => { void commitEffort(index) }}
                onDraggingChange={setDragging}
              />
              : <div className={css.empty}>{t('effort.unavailable')}</div>}
            {levels.length < 2 && error !== null ? <div className={css.error} role="alert">{error}</div> : null}
            <div className={css.separator} />
          </div>
          <div
            className={css.modelViewport}
            data-testid="reasoning-model-scroll"
          >
            <div className={css.sectionTitle}>{t('model.title')}</div>
            {state.status === 'loading' && state.groups.length === 0
              ? <div className={css.empty}>{t('model.loading')}</div>
              : null}
            <div className={css.modelList}>
              {state.groups.map(group => (
                <section key={group.id} className={css.modelGroup} aria-label={group.name}>
                  <div className={css.groupTitle}>{group.name}</div>
                  {group.models.map((model) => {
                    const selectedModel = state.current?.provider === group.id && state.current.model === model.id
                    return (
                      <button
                        type="button"
                        className={css.modelOption}
                        key={`${group.id}/${model.id}`}
                        disabled={busy}
                        aria-pressed={selectedModel}
                        onClick={() => { void chooseModel(group.id, model.id, model.reasoning?.defaultEffort) }}
                      >
                        <span className={css.modelCopy}>
                          <span className={css.modelName}>{model.name}</span>
                          {model.description === undefined ? null : <span className={css.description}>{model.description}</span>}
                        </span>
                        <span className={css.check}>{selectedModel ? <IconCheckOutline16 /> : null}</span>
                      </button>
                    )
                  })}
                </section>
              ))}
            </div>
            {state.status === 'ready' && state.groups.every(group => group.models.length === 0)
              ? <div className={css.empty}>{t('model.empty')}</div>
              : null}
          </div>
          {preferenceAvailable ? (
            <div className={css.preferenceFooter} data-testid="reasoning-preference-footer">
              <button
                type="button"
                role="switch"
                aria-checked={preference.enabled}
                className={css.characterToggle}
                disabled={preference.pending}
                onClick={() => {
                  setError(null)
                  void preference.toggle().then((accepted) => {
                    if (!accepted) setError(t('character.failed'))
                  })
                }}
              >
                <span>{t('character.label')}</span>
                <span>{preference.enabled ? t('character.on') : t('character.off')}</span>
              </button>
            </div>
          ) : null}
        </div>,
        document.body,
      )}
    </div>
  )
}

/** Slot component: addressed subagents render nothing and touch no directory. */
export function EffortControl(
  props: EffortControlInjected & { readonly locked: boolean } & PropsLocale<'reasoningEffort'>,
) {
  if (!props.available) return null
  return <ActiveEffortControl
    locked={props.locked}
    controller={props.controller}
    sessionId={props.sessionId}
    t={props.t}
  />
}
