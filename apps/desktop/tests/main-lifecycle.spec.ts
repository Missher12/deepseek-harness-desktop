import { describe, expect, it, vi } from 'vitest'
import {
  DesktopApplication,
  type AppFacade,
  type DesktopWindow,
  type RuntimeController,
} from '../src/application.ts'
import type { DesktopStartupMilestone } from '../src/startup-timeline.ts'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class FakeApp implements AppFacade {
  readonly handlers = new Map<string, Array<(...args: never[]) => void>>()
  readonly quit = vi.fn()
  readonly exit = vi.fn()
  lock = true

  requestSingleInstanceLock(): boolean { return this.lock }
  async whenReady(): Promise<void> {}
  on(event: string, listener: (...args: never[]) => void): void {
    const listeners = this.handlers.get(event) ?? []
    listeners.push(listener)
    this.handlers.set(event, listeners)
  }
  emit(event: string, ...args: never[]): void {
    for (const listener of this.handlers.get(event) ?? []) listener(...args)
  }
}

function createWindow(): DesktopWindow & {
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  loadLoading: ReturnType<typeof vi.fn>
  loadHarness: ReturnType<typeof vi.fn>
  loadFailure: ReturnType<typeof vi.fn>
} {
  return {
    show: vi.fn<() => void>(),
    focus: vi.fn<() => void>(),
    loadLoading: vi.fn(async () => undefined),
    loadHarness: vi.fn(async () => undefined),
    loadFailure: vi.fn(async () => undefined),
    sendCommand: vi.fn(),
  }
}

function createRuntime(): RuntimeController & {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
} {
  return {
    start: vi.fn(async () => 'http://127.0.0.1:45678/'),
    stop: vi.fn(async () => undefined),
  }
}

describe('DesktopApplication', () => {
  it('shows only after local loading content is ready, then loads the desktop URL', async () => {
    const app = new FakeApp()
    const window = createWindow()
    const loading = deferred<undefined>()
    window.loadLoading.mockReturnValueOnce(loading.promise)
    const runtime = createRuntime()
    const markStartup = vi.fn<(milestone: DesktopStartupMilestone) => void>()
    const controller = new DesktopApplication({
      app,
      createWindow: async () => window,
      runtime,
      findConflict: async () => undefined,
      workspace: '/workspace',
      markStartup,
    })

    const running = controller.run()
    await vi.waitFor(() => { expect(window.loadLoading).toHaveBeenCalledOnce() })
    expect(window.show).not.toHaveBeenCalled()
    loading.resolve(undefined)
    await running

    expect(window.show).toHaveBeenCalledOnce()
    expect(window.loadHarness).toHaveBeenCalledWith('http://127.0.0.1:45678/?surface=desktop')
    expect(markStartup.mock.calls.map(([milestone]) => milestone)).toEqual([
      'app-ready',
      'loading-visible',
      'desktop-running',
    ])
  })

  it('overlaps the loading surface with conflict detection and safe runtime startup', async () => {
    const app = new FakeApp()
    const window = createWindow()
    const loading = deferred<undefined>()
    window.loadLoading.mockReturnValueOnce(loading.promise)
    const conflict = deferred<undefined>()
    const findConflict = vi.fn(() => conflict.promise)
    const runtime = createRuntime()
    const controller = new DesktopApplication({
      app,
      createWindow: async () => window,
      runtime,
      findConflict,
      workspace: '/workspace',
    })

    const running = controller.run()
    await vi.waitFor(() => { expect(window.loadLoading).toHaveBeenCalledOnce() })
    const conflictStartedBeforeLoading = findConflict.mock.calls.length === 1
    let runtimeStartedBeforeLoading = false
    try {
      conflict.resolve(undefined)
      await vi.waitFor(() => { expect(runtime.start).toHaveBeenCalledOnce() })
      runtimeStartedBeforeLoading = true
    } finally {
      loading.resolve(undefined)
      await running
    }

    expect(conflictStartedBeforeLoading).toBe(true)
    expect(runtimeStartedBeforeLoading).toBe(true)
  })

  it('renders a conflict without starting another writer', async () => {
    const app = new FakeApp()
    const window = createWindow()
    const runtime = createRuntime()
    const controller = new DesktopApplication({
      app,
      createWindow: async () => window,
      runtime,
      findConflict: async () => ({ pid: 91, command: 'dsh web' }),
      workspace: '/workspace',
    })

    await controller.run()

    expect(runtime.start).not.toHaveBeenCalled()
    expect(window.loadFailure).toHaveBeenCalledWith('runtime-conflict')
  })

  it('focuses the existing window for a second instance', async () => {
    const app = new FakeApp()
    const window = createWindow()
    const controller = new DesktopApplication({
      app,
      createWindow: async () => window,
      runtime: createRuntime(),
      findConflict: async () => undefined,
      workspace: '/workspace',
    })
    await controller.run()

    app.emit('second-instance')

    expect(window.show).toHaveBeenCalledTimes(2)
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('waits for owned runtime shutdown before allowing quit', async () => {
    const app = new FakeApp()
    const window = createWindow()
    const runtime = createRuntime()
    const stopped = deferred<undefined>()
    runtime.stop.mockReturnValueOnce(stopped.promise)
    const controller = new DesktopApplication({
      app,
      createWindow: async () => window,
      runtime,
      findConflict: async () => undefined,
      workspace: '/workspace',
    })
    await controller.run()
    const event = { preventDefault: vi.fn() }

    app.emit('before-quit', event as never)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(app.exit).not.toHaveBeenCalled()
    stopped.resolve(undefined)
    await vi.waitFor(() => { expect(app.exit).toHaveBeenCalledWith(0) })
  })

  it('moves an unexpected owned runtime exit to the closed failure surface', async () => {
    const app = new FakeApp()
    const window = createWindow()
    const controller = new DesktopApplication({
      app,
      createWindow: async () => window,
      runtime: createRuntime(),
      findConflict: async () => undefined,
      workspace: '/workspace',
    })
    await controller.run()

    await controller.runtimeExited()

    expect(window.loadFailure).toHaveBeenCalledWith('runtime-exit')
  })

  it('accepts recovery actions only while the closed failure surface is active', async () => {
    const app = new FakeApp()
    const controller = new DesktopApplication({
      app,
      createWindow: async () => createWindow(),
      runtime: createRuntime(),
      findConflict: async () => undefined,
      workspace: '/workspace',
    })
    await controller.run()

    controller.recover('quit')
    expect(app.quit).not.toHaveBeenCalled()
    await controller.runtimeExited()
    controller.recover('quit')
    expect(app.quit).toHaveBeenCalledOnce()
  })
})
