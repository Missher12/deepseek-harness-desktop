/**
 * Native Desktop boot continuity surface. It is deliberately kernel-local and
 * self-contained: plugin failures must remain visible even when no UI plugin
 * can activate.
 */
import css from './DesktopBootSurface.module.css'
import { desktopBootCopy as copy } from './locales/desktop-boot.ts'

export { isDesktopSurface } from './desktop-surface.ts'

/** Visual phase for the native Desktop startup surface. */
export type DesktopBootPhase = 'hold' | 'exit'

/** Inputs owned by the shell boot gate. */
export interface DesktopBootSurfaceProps {
  /** Hold while plugins boot; exit once the real application is mounted beneath it. */
  phase: DesktopBootPhase
  /** Loader entries whose root fiber failed. */
  failed: ReadonlyArray<readonly [string, string]>
  /** Kernel settlement failure, when the sweep could not activate every entry. */
  error?: string
}

/** Render the DeepSeek-colored startup hold and direct-entry wipe. */
export function DesktopBootSurface(props: DesktopBootSurfaceProps) {
  const loud = props.error !== undefined || props.failed.length > 0
  return (
    <div
      className={css.surface}
      data-desktop-boot-phase={props.phase}
      aria-live="polite"
    >
      <div className={css.grain} aria-hidden="true" />
      <div className={css.grid} aria-hidden="true" />
      <div className={css.beam} aria-hidden="true" />
      <div className={css.cornerTop} aria-hidden="true" />
      <div className={css.cornerBottom} aria-hidden="true" />

      <div className={css.brand}>
        <div className={css.mark} aria-hidden="true" />
        <div className={css.copy}>
          <div className={css.eyebrow}>{copy.eyebrow}</div>
          <div className={css.title}>{copy.brand} <span>{copy.product}</span></div>
          {!loud
            ? (
              <>
                <div className={css.systemLine}>
                  <span className={css.pulse} aria-hidden="true" />
                  {copy.ready}
                </div>
                <div
                  className={css.progress}
                  role="progressbar"
                  aria-label={copy.progressLabel}
                  aria-valuetext={copy.progressValue}
                >
                  <span aria-hidden="true" />
                </div>
              </>
            )
            : (
              <div className={css.failed}>
                <div className={css.failedTitle}>{copy.failed}</div>
                {props.failed.map(([id]) => <div key={id} className={css.failedItem}>{id}</div>)}
                {props.error !== undefined && <div className={css.failedItem}>{props.error}</div>}
              </div>
            )}
        </div>
      </div>

      <div className={css.wipe} aria-hidden="true" />
    </div>
  )
}
