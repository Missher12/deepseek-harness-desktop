import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import clsx from 'clsx'
import css from './ModelSelect.module.css'
import { useEffortFire } from './use-effort-fire.ts'

/** One Host-advertised effort stop; undefined preserves the provider default. */
export interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

/** Presentation-only alias; the wire value is never changed. */
export function effortDisplayName(choice: Pick<EffortChoice, 'effort' | 'label'>): string {
  return choice.effort === 'max' ? 'ULTRACODE' : choice.label
}

interface EffortSliderProps {
  label: string
  fasterLabel: string
  smarterLabel: string
  choices: readonly EffortChoice[]
  value: string | undefined
  disabled: boolean
  onCommit: (effort: string | undefined) => void
}

const PARTICLES = Array.from({ length: 18 }, (_, index) => index)

function pointerCapture(target: HTMLDivElement, method: 'setPointerCapture' | 'releasePointerCapture', id: number): void {
  const callback = Reflect.get(target, method) as ((pointerId: number) => void) | undefined
  callback?.call(target, id)
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => { setReduced(query.matches) }
    update()
    query.addEventListener('change', update)
    return () => { query.removeEventListener('change', update) }
  }, [])
  return reduced
}

/** Accessible discrete slider backed only by the model's advertised effort rows. */
export function EffortSlider({
  label,
  fasterLabel,
  smarterLabel,
  choices,
  value,
  disabled,
  onCommit,
}: EffortSliderProps) {
  const selectedIndex = Math.max(0, choices.findIndex(choice => choice.effort === value))
  const selected = choices[selectedIndex]
  const maximum = Math.max(choices.length - 1, 0)
  const committedProgress = maximum === 0 ? 0 : selectedIndex / maximum
  const [dragProgress, setDragProgress] = useState<number | undefined>()
  const dragging = useRef(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reducedMotion = useReducedMotion()
  const progress = dragProgress ?? committedProgress
  const previewIndex = Math.round(progress * maximum)
  const visualChoice = choices[previewIndex] ?? selected
  useEffortFire(canvasRef, progress, !reducedMotion)
  const style = useMemo(() => ({
    '--effort-progress': String(progress),
    '--effort-energy': String((previewIndex + 1) / Math.max(choices.length, 1)),
  }) as CSSProperties, [choices.length, previewIndex, progress])

  const commit = (index: number): void => {
    if (disabled) return
    const choice = choices[Math.max(0, Math.min(index, maximum))]
    if (choice !== undefined && choice.effort !== value) onCommit(choice.effort)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    let next: number | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = selectedIndex + 1
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = selectedIndex - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = maximum
    if (next === undefined) return
    event.preventDefault()
    event.stopPropagation()
    commit(next)
  }

  const pointerProgress = (event: PointerEvent<HTMLDivElement>): number | undefined => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0) return undefined
    return Math.max(0, Math.min((event.clientX - bounds.left) / bounds.width, 1))
  }

  const valueText = visualChoice === undefined
    ? label
    : `${effortDisplayName(visualChoice)}${visualChoice.description === undefined ? '' : `, ${visualChoice.description}`}`

  return (
    <div className={css.effortPanel} style={style} data-testid="effort-panel">
      <canvas
        ref={canvasRef}
        className={css.effortFireCanvas}
        data-testid="effort-fire-canvas"
        aria-hidden="true"
      />
      <span className={css.effortMosaic} aria-hidden="true" />
      <div className={css.effortHeader}>
        <span className={css.effortEyebrow}>{label}</span>
        <span className={css.effortCurrent}>{visualChoice === undefined ? '—' : effortDisplayName(visualChoice)}</span>
      </div>
      <div
        className={clsx(css.effortSlider, disabled && css.effortSliderDisabled)}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-disabled={disabled}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={maximum}
        aria-valuenow={previewIndex}
        aria-valuetext={valueText}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (disabled || choices.length === 0) return
          const next = pointerProgress(event)
          if (next === undefined) return
          dragging.current = true
          pointerCapture(event.currentTarget, 'setPointerCapture', event.pointerId)
          event.preventDefault()
          event.stopPropagation()
          setDragProgress(next)
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return
          const next = pointerProgress(event)
          if (next !== undefined) setDragProgress(next)
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return
          dragging.current = false
          const next = pointerProgress(event) ?? progress
          pointerCapture(event.currentTarget, 'releasePointerCapture', event.pointerId)
          setDragProgress(undefined)
          commit(Math.round(next * maximum))
        }}
        onPointerCancel={() => {
          dragging.current = false
          setDragProgress(undefined)
        }}
      >
        <span className={css.effortDirection} aria-hidden="true">
          <span>{fasterLabel}</span>
          <span>{smarterLabel}</span>
        </span>
        <span className={css.effortAura} aria-hidden="true" />
        <span className={css.effortParticles} aria-hidden="true">
          {PARTICLES.map(index => (
            <i
              key={index}
              style={{
                '--particle-x': `${(index % 3) * 4}px`,
                '--particle-y': `${(index % 6) * 7}px`,
                '--particle-size': `${1 + (index % 2)}px`,
                '--particle-duration': `${1.8 + (index % 5) * 0.24}s`,
                '--particle-delay': `${index * -0.13}s`,
              } as CSSProperties}
            />
          ))}
        </span>
        <span className={css.effortTrack} aria-hidden="true">
          <span className={css.effortTrackFill} />
        </span>
        <span className={css.effortThumb} aria-hidden="true">
          <span className={css.effortThumbCore} />
        </span>
      </div>
      <div className={css.effortStops}>
        {choices.map((choice, index) => {
          const active = index === selectedIndex
          return (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={clsx(css.effortStop, active && css.effortStopActive)}
              key={choice.key}
              disabled={disabled}
              title={choice.description}
              onClick={() => { commit(index) }}
            >
              <span className={css.effortStopDot} aria-hidden="true" />
              <span>{effortDisplayName(choice)}</span>
            </button>
          )
        })}
      </div>
      {visualChoice?.description !== undefined && (
        <p className={css.effortDescription}>{visualChoice.description}</p>
      )}
    </div>
  )
}
