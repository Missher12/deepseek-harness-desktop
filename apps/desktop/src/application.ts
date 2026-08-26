import type { HarnessConflict } from './harness/ownership.ts'
import type { DesktopCommand, RecoveryAction } from './preload-api.ts'
import type { DesktopStartupMilestone } from './startup-timeline.ts'

/** Closed reasons rendered by the local failure page. */
export type FailureReason = 'runtime-conflict' | 'startup' | 'renderer' | 'runtime-exit'

/** Minimal Electron application behavior required by the lifecycle controller. */
export interface AppFacade {
  requestSingleInstanceLock(): boolean
  whenReady(): Promise<void>
  on(event: string, listener: (...args: unknown[]) => void): void
  quit(): void
  exit(code: number): void
}

/** BrowserWindow operations owned by the lifecycle controller. */
export interface DesktopWindow {
  loadLoading(): Promise<void>
  loadHarness(url: string): Promise<void>
  loadFailure(reason: FailureReason): Promise<void>
  show(): void
  focus(): void
  sendCommand(command: DesktopCommand): void
}

/** Harness child operations owned by the lifecycle controller. */
export interface RuntimeController {
  start(workspace: string): Promise<string>
  stop(): Promise<void>
}

/** Dependencies that connect the pure lifecycle controller to Electron and macOS. */
export interface DesktopApplicationOptions {
  app: AppFacade
  createWindow: () => Promise<DesktopWindow>
  runtime: RuntimeController
  findConflict: () => Promise<HarnessConflict | undefined>
  workspace: string
  openLogs?: () => void
  log?: (message: string) => void | Promise<void>
  markStartup?: (milestone: DesktopStartupMilestone) => void
}

type ApplicationState = 'idle' | 'starting' | 'running' | 'failure' | 'shutting-down'

function desktopUrl(root: string): string {
  const url = new URL(root)
  url.searchParams.set('surface', 'desktop')
  return url.href
}

function preventQuit(args: readonly unknown[]): void {
  const event = args[0]
  if (typeof event !== 'object' || event === null) return
  const preventDefault = (event as { preventDefault?: unknown }).preventDefault
  if (typeof preventDefault === 'function') preventDefault.call(event)
}

/** Coordinates one native window and one owned Harness runtime. */
export class DesktopApplication {
  private readonly options: DesktopApplicationOptions
  private window: DesktopWindow | undefined
  private state: ApplicationState = 'idle'
  private handlersInstalled = false
  private launchPromise: Promise<void> | undefined
  private shutdownPromise: Promise<void> | undefined
  private allowQuit = false

  /**
   * Create an idle desktop application controller.
   * @param options - Injected application, window, runtime, and ownership operations.
   */
  constructor(options: DesktopApplicationOptions) {
    this.options = options
  }

  /** Acquire the single-instance lock, install lifecycle handlers, and launch. */
  async run(): Promise<void> {
    if (!this.options.app.requestSingleInstanceLock()) {
      this.options.app.quit()
      return
    }
    this.installHandlers()
    await this.options.app.whenReady()
    this.options.markStartup?.('app-ready')
    await this.launch()
  }

  /** Send one already validated native menu command to the current renderer. */
  sendCommand(command: DesktopCommand): void {
    this.window?.sendCommand(command)
  }

  /**
   * Handle one validated recovery request from the local failure page.
   * @param action - Retry, reveal logs, or quit.
   */
  recover(action: RecoveryAction): void {
    if (this.state !== 'failure') return
    if (action === 'retry') {
      void this.retry()
      return
    }
    if (action === 'open-logs') {
      this.options.openLogs?.()
      return
    }
    this.options.app.quit()
  }

  /** Move an unexpected owned runtime exit to the local failure page. */
  async runtimeExited(): Promise<void> {
    if (this.state !== 'running') return
    this.state = 'failure'
    await this.options.log?.('owned Harness runtime exited unexpectedly')
    await this.window?.loadFailure('runtime-exit')
  }

  /** Move an unexpected renderer exit to the local failure page. */
  async rendererExited(): Promise<void> {
    if (this.state === 'shutting-down') return
    this.state = 'failure'
    await this.options.log?.('Harness renderer exited unexpectedly')
    await this.window?.loadFailure('renderer')
  }

  private installHandlers(): void {
    if (this.handlersInstalled) return
    this.handlersInstalled = true
    this.options.app.on('second-instance', () => { this.revealWindow() })
    this.options.app.on('activate', () => { this.revealWindow() })
    this.options.app.on('before-quit', (...args) => {
      if (this.allowQuit) return
      preventQuit(args)
      void this.shutdown()
    })
  }

  private revealWindow(): void {
    this.window?.show()
    this.window?.focus()
  }

  private async ensureWindow(): Promise<DesktopWindow> {
    this.window ??= await this.options.createWindow()
    await this.window.loadLoading()
    this.window.show()
    this.options.markStartup?.('loading-visible')
    return this.window
  }

  private launch(): Promise<void> {
    if (this.launchPromise !== undefined) return this.launchPromise
    const operation = this.launchOnce().finally(() => {
      if (this.launchPromise === operation) this.launchPromise = undefined
    })
    this.launchPromise = operation
    return operation
  }

  private async launchOnce(): Promise<void> {
    this.state = 'starting'
    const windowPromise = this.ensureWindow()
    let runtimeStarted = false
    try {
      const conflict = await this.options.findConflict()
      if (conflict !== undefined) {
        const window = await windowPromise
        this.state = 'failure'
        await this.options.log?.(`runtime conflict pid=${String(conflict.pid)}`)
        await window.loadFailure('runtime-conflict')
        return
      }
      runtimeStarted = true
      const [window, root] = await Promise.all([
        windowPromise,
        this.options.runtime.start(this.options.workspace),
      ])
      await window.loadHarness(desktopUrl(root))
      this.state = 'running'
      this.options.markStartup?.('desktop-running')
    } catch (error) {
      let window: DesktopWindow
      try {
        window = await windowPromise
      } catch (windowError) {
        if (runtimeStarted) await this.options.runtime.stop()
        throw windowError
      }
      this.state = 'failure'
      const message = error instanceof Error ? error.message : String(error)
      await this.options.log?.(`startup failed: ${message}`)
      await window.loadFailure('startup')
    }
  }

  private async retry(): Promise<void> {
    if (this.state !== 'failure') return
    await this.options.runtime.stop()
    this.state = 'idle'
    await this.launch()
  }

  private shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise
    this.state = 'shutting-down'
    const operation = this.options.runtime.stop()
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        await this.options.log?.(`shutdown failed: ${message}`)
      })
      .then(() => {
        this.allowQuit = true
        this.options.app.exit(0)
      })
    this.shutdownPromise = operation
    return operation
  }
}
