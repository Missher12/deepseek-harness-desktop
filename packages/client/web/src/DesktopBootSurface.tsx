/**
 * macOS Desktop boot continuity surface. It is deliberately kernel-local and
 * self-contained: plugin failures must remain visible even when no UI plugin
 * can activate.
 */
import css from './DesktopBootSurface.module.css'

/** Visual phase for the macOS Desktop startup surface. */
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

/**
 * Decide whether the current renderer is the macOS native Desktop surface.
 * Ordinary browser and Windows Desktop surfaces retain the generic boot UI.
 */
export function isMacDesktopSurface(search: string, userAgent: string): boolean {
  return new URLSearchParams(search).get('surface') === 'desktop'
    && /Macintosh|Mac OS X/u.test(userAgent)
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
          <div className={css.eyebrow}>Local intelligence system</div>
          <div className={css.title}>DeepSeek <span>Harness</span></div>
          {!loud
            ? (
              <>
                <div className={css.systemLine}>
                  <span className={css.pulse} aria-hidden="true" />
                  Desktop runtime ready
                </div>
                <div
                  className={css.progress}
                  role="progressbar"
                  aria-label="正在启动"
                  aria-valuetext="正在初始化桌面运行时"
                >
                  <span aria-hidden="true" />
                </div>
              </>
            )
            : (
              <div className={css.failed}>
                <div className={css.failedTitle}>Failed to load plugins</div>
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
