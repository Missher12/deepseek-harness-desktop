/**
 * Framework-free boot page and failure report. It remains available when a
 * client plugin fails because React arrives only with the UI renderer.
 * @module @deepseek-ai/dsh-client-web/src/boot-page
 */
import type { LoaderEntryState } from './loader-status.ts'
import css from './boot-page.module.css'
import { isDesktopSurface } from './desktop-surface.ts'

/** Browser inputs used to select the explicit native Desktop boot surface. */
export interface BootPageEnvironment {
  search: string
  /** Retained as a test seam; platform no longer changes native Desktop branding. */
  userAgent: string
}

/** Read browser state lazily so tests can supply a deterministic environment. */
function browserEnvironment(): BootPageEnvironment {
  return {
    search: globalThis.location.search,
    userAgent: globalThis.navigator.userAgent,
  }
}

/** Create a div with one module class and optional text. */
function div(className: string | undefined, text?: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className ?? ''
  if (text !== undefined) el.textContent = text
  return el
}

/** Kernel-owned page mounted below the application's root element. */
export class BootPage {
  private readonly root: HTMLDivElement
  private readonly card: HTMLDivElement
  private readonly wordmark: HTMLDivElement
  private readonly spinner: HTMLDivElement
  private readonly hint: HTMLDivElement
  private readonly desktop: boolean
  private readonly icon: HTMLImageElement | undefined
  private readonly linear: HTMLDivElement | undefined
  private readonly linearFill: HTMLDivElement | undefined
  private readonly macStatus: HTMLDivElement | undefined
  private readonly macCount: HTMLDivElement | undefined
  private readonly macPercent: HTMLDivElement | undefined
  private readonly states = new Map<string, LoaderEntryState>()
  private readonly active = new Set<string>()
  private total = 0
  private failure: string | undefined

  /**
   * Build and attach the boot page.
   * @param container - Application mount point.
   */
  constructor(container: HTMLElement, environment: BootPageEnvironment = browserEnvironment()) {
    this.desktop = isDesktopSurface(environment.search)
    this.root = div(css.boot)
    this.root.dataset.dshBoot = ''
    if (this.desktop) this.root.dataset.dshBootDesktop = ''
    this.card = div(css.card)
    this.wordmark = div(css.wordmark, 'HARNESS')
    this.spinner = div(css.spinner)
    this.spinner.dataset.dshBootSpinner = ''
    this.hint = div(css.hint, 'Loading plugins…')
    if (this.desktop) {
      this.icon = document.createElement('img')
      this.icon.className = css.macIcon ?? ''
      this.icon.src = '/desktop-icon.png'
      this.icon.alt = ''
      this.icon.dataset.dshBootIcon = ''
      this.wordmark.textContent = 'DeepSeek Harness'
      this.hint.textContent = '正在准备你的工作区'
      this.linear = div(css.macProgress)
      this.linear.dataset.dshBootLinear = ''
      this.linear.setAttribute('role', 'progressbar')
      this.linear.setAttribute('aria-label', '正在加载组件')
      this.linear.setAttribute('aria-valuemin', '0')
      this.linear.setAttribute('aria-valuemax', '100')
      this.linearFill = div(css.macProgressFill)
      this.linear.append(this.linearFill)
      this.macStatus = div(css.macStatus)
      this.macCount = div(undefined, '正在加载组件 0 / 0')
      this.macPercent = div(undefined, '0%')
      this.macStatus.append(this.macCount, this.macPercent)
    } else {
      this.icon = undefined
      this.linear = undefined
      this.linearFill = undefined
      this.macStatus = undefined
      this.macCount = undefined
      this.macPercent = undefined
    }
    this.renderLoading()
    this.root.append(this.card)
    container.append(this.root)
    this.updateProgress()
  }

  /**
   * Set the number of loader entries represented by the progress arc.
   * @param total - Complete boot roster size.
   */
  setTotal(total: number): void {
    this.total = total
    this.updateProgress()
  }

  /**
   * Project one loader entry's fiber state.
   * @param id - Loader entry name.
   * @param state - Projected fiber state.
   */
  setState(id: string, state: LoaderEntryState): void {
    this.states.set(id, state)
    if (state === 'active') this.active.add(id)
    this.updateProgress()
    this.render()
  }

  /**
   * Display the boot failure report.
   * @param message - Failure report text.
   */
  fail(message: string): void {
    this.failure = message
    this.render()
  }

  /** Detach the page before or after the UI renderer takes the mount point. */
  dispose(): void {
    this.root.remove()
  }

  /** Redraw the state-dependent content below the wordmark. */
  private render(): void {
    const failed = [...this.states].filter(([, state]) => state === 'failed').map(([id]) => id)
    if (this.failure === undefined && failed.length === 0) {
      this.renderLoading()
      return
    }
    const report = div(css.failed)
    report.append(div(css.failedTitle, 'Failed to load plugins'))
    for (const id of failed) report.append(div(css.failedItem, id))
    if (this.failure !== undefined) report.append(div(css.failedItem, this.failure))
    this.card.replaceChildren(this.wordmark, report)
  }

  /** Restore the correct generic Web or native Desktop composition after state changes. */
  private renderLoading(): void {
    if (this.desktop) {
      if (this.linear?.parentElement !== this.card) {
        this.card.replaceChildren(
          this.icon as HTMLImageElement,
          this.wordmark,
          this.hint,
          this.linear as HTMLDivElement,
          this.macStatus as HTMLDivElement,
        )
      }
      return
    }
    if (this.spinner.parentElement !== this.card) {
      this.card.replaceChildren(this.wordmark, this.spinner, this.hint)
    }
  }

  /** Grow the rotating arc monotonically as loader entries activate. */
  private updateProgress(): void {
    const ratio = this.total === 0 ? 0 : Math.min(this.active.size / this.total, 1)
    this.spinner.style.setProperty('--dsh-boot-arc', `${String(Math.round(72 + ratio * 216))}deg`)
    const percent = Math.round(ratio * 100)
    this.linear?.setAttribute('aria-valuenow', String(percent))
    this.linear?.setAttribute(
      'aria-valuetext',
      `正在加载组件 ${String(this.active.size)} / ${String(this.total)}`,
    )
    this.linearFill?.style.setProperty('--dsh-boot-progress', `${String(percent)}%`)
    if (this.macCount !== undefined) {
      this.macCount.textContent = `正在加载组件 ${String(this.active.size)} / ${String(this.total)}`
    }
    if (this.macPercent !== undefined) this.macPercent.textContent = `${String(percent)}%`
  }
}
