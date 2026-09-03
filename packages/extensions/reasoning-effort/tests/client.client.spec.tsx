// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectory, ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  EffortControl,
  apply,
  type EffortControlInjected,
} from '../src/client/index.tsx'
import { zh } from '../src/client/locales.ts'

const t = (key: string, params?: Record<string, unknown>): string => {
  const template = (zh as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const efforts = [
  { id: 'low', name: 'Low' },
  { id: 'high', name: 'High' },
  { id: 'max', name: 'Max' },
]

type SessionModels = Omit<ModelDirectoryState, 'status' | 'error'>

function models(overrides: Partial<SessionModels> = {}): SessionModels {
  return {
    current: { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' },
    routable: true,
    groups: [{
      id: 'deepseek',
      name: 'DeepSeek',
      models: [{
        id: 'chat',
        name: 'DeepSeek Chat',
        reasoning: { efforts, defaultEffort: 'high' },
      }, {
        id: 'coder',
        name: 'DeepSeek Coder',
        reasoning: { efforts: efforts.slice(0, 2), defaultEffort: 'low' },
      }],
    }],
    failures: [],
    ...overrides,
  }
}

function stateOf(value: SessionModels): ModelDirectoryState {
  return {
    ...value,
    status: 'ready',
    error: null,
  }
}

function makeController(sequence: SessionModels[] = [models()]) {
  const store = createSnapshotStore<ModelDirectoryState>(stateOf(sequence[0]!))
  let loadIndex = 0
  const load = vi.fn(async () => {
    const value = sequence[Math.min(loadIndex, sequence.length - 1)]!
    loadIndex += 1
    store.set(stateOf(value))
    return stateOf(value)
  })
  const select = vi.fn(async (selection: ModelSelection) => {
    store.update((state) => {
      state.current = selection
      state.status = 'ready'
      state.error = null
    })
  })
  return {
    controller: { store, load, select } as unknown as ModelDirectory,
    load,
    select,
    store,
  }
}

function renderControl(
  controller: ModelDirectory,
  locked = false,
  sessionId = 'reasoning-effort-test-session' as SessionId,
) {
  return render(<EffortControl
    locked={locked}
    available
    controller={controller}
    sessionId={sessionId}
    t={t as never}
  />)
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left, y: top, left, top, width, height,
    right: left + width, bottom: top + height,
    toJSON: () => ({}),
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

let frames: Map<number, FrameRequestCallback>

beforeEach(() => {
  frames = new Map()
  let frameId = 0
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    const id = ++frameId
    frames.set(id, callback)
    return id
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id) }))
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  })
  vi.stubGlobal('IntersectionObserver', class {
    observe(): void {}
    disconnect(): void {}
  })
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  Object.defineProperties(HTMLInputElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    releasePointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => false) },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as { __DSH_REASONING_EFFORT__?: unknown }).__DSH_REASONING_EFFORT__
})

async function flushFrames(): Promise<void> {
  await act(async () => {
    for (let pass = 0; pass < 5 && frames.size > 0; pass += 1) {
      const pending = [...frames.entries()]
      frames.clear()
      for (const [id, callback] of pending) callback(id * 16)
      await Promise.resolve()
    }
  })
}

describe('reasoning-effort Client registration', () => {
  it('registers the single model seat at -100 and never resolves or loads an addressed subagent', () => {
    let registered: { options: Record<string, unknown>; component: unknown } | undefined
    const directoryFor = vi.fn(() => makeController().controller)
    const addressed = 'addressed' as SessionId
    const ctx = {
      effect: (setup: () => unknown) => setup(),
      locale: { register: vi.fn(() => vi.fn()) },
      modelDirectories: { directoryFor },
      sessions: { subagentAddress: (sessionId: SessionId) => sessionId === addressed ? { mode: 'run' } : undefined },
      slots: {
        inject: (_name: string, register: () => unknown) => register(),
        register: (options: Record<string, unknown>, component: unknown) => {
          registered = { options, component }
          return vi.fn()
        },
      },
    }

    apply(ctx as never)
    expect(registered?.options).toMatchObject({
      name: 'conversation.input.model',
      priority: -100,
      locale: 'reasoningEffort',
    })
    const inject = registered?.options.inject as (sessionId: SessionId) => EffortControlInjected
    expect(inject(addressed)).toEqual({ available: false, controller: null })
    expect(directoryFor).not.toHaveBeenCalled()
    const hidden = render(<EffortControl locked={false} {...inject(addressed)} t={t as never} />)
    expect(hidden.container.childElementCount).toBe(0)
    expect(directoryFor).not.toHaveBeenCalled()
    const topLevel = 'top-level' as SessionId
    const topLevelInjection = inject(topLevel)
    expect(topLevelInjection.available).toBe(true)
    if (topLevelInjection.available) {
      expect(topLevelInjection.sessionId).toBe(topLevel)
      expect(topLevelInjection.controller).toBeTruthy()
    }
    expect(directoryFor).toHaveBeenCalledWith(topLevel)
  })
})

describe('EffortControl', () => {
  it('loads an idle model directory on mount before the user opens the control', async () => {
    const b = makeController()
    act(() => {
      b.store.set({
        current: null,
        routable: false,
        groups: [],
        failures: [],
        status: 'idle',
        error: null,
      })
    })

    renderControl(b.controller)

    await waitFor(() => { expect(b.load).toHaveBeenCalledTimes(1) })
    expect(await screen.findByRole('button', {
      name: /选择模型.*DeepSeek Chat.*High/,
    })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('coalesces an in-flight model load and skips only an immediately repeated successful refresh', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const next = models()
    const pending = deferred<SessionModels>()
    const store = createSnapshotStore<ModelDirectoryState>({
      current: null,
      routable: false,
      groups: [],
      failures: [],
      status: 'idle',
      error: null,
    })
    const load = vi.fn(async () => {
      const value = await pending.promise
      store.set(stateOf(value))
      return stateOf(value)
    })
    const controller = {
      store,
      load,
      select: vi.fn(async () => undefined),
    } as unknown as ModelDirectory
    renderControl(controller)
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })

    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve(next)
      await pending.promise
    })
    await flushFrames()
    await screen.findByRole('slider', { name: '推理等级' })

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    now = 749
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    expect(load).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    now = 751
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
  })

  it('resyncs from Host effort and model updates instead of retaining an old accepted ID', async () => {
    const sameModelLow = models({
      current: { provider: 'deepseek', model: 'chat', reasoningEffort: 'low' },
    })
    const changedModelDefaultLow = models({
      current: { provider: 'deepseek', model: 'coder' },
    })
    const b = makeController([models(), sameModelLow, changedModelDefaultLow])
    renderControl(b.controller)
    let trigger = screen.getByRole('button', { name: /DeepSeek Chat.*High/ })
    fireEvent.click(trigger)
    await flushFrames()
    let slider = await screen.findByRole('slider', { name: '推理等级' }) as HTMLInputElement
    expect(slider.value).toBe('2')
    fireEvent.keyDown(slider, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })

    act(() => { b.store.set(stateOf(sameModelLow)) })
    trigger = await screen.findByRole('button', { name: /DeepSeek Chat.*Low/ })
    fireEvent.click(trigger)
    await flushFrames()
    slider = await screen.findByRole('slider', { name: '推理等级' }) as HTMLInputElement
    expect(slider.value).toBe('0')
    expect(slider.getAttribute('aria-valuetext')).toBe('Low')
    fireEvent.keyDown(slider, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })

    act(() => { b.store.set(stateOf(changedModelDefaultLow)) })
    trigger = await screen.findByRole('button', { name: /DeepSeek Coder.*Low/ })
    fireEvent.click(trigger)
    await flushFrames()
    slider = await screen.findByRole('slider', { name: '推理等级' }) as HTMLInputElement
    expect(slider.value).toBe('0')
    expect(slider.getAttribute('aria-valuetext')).toBe('Low')
  })

  it('refreshes on open, portals down-first with every bound, and commits a revalidated Host effort', async () => {
    const b = makeController([models(), models()])
    renderControl(b.controller)
    const trigger = screen.getByRole('button', { name: /选择模型.*DeepSeek Chat.*High/ })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 180, 28))

    fireEvent.click(trigger)
    await waitFor(() => { expect(b.load).toHaveBeenCalledTimes(1) })
    const popup = document.querySelector<HTMLDivElement>('[role="dialog"]')!
    expect(popup.getAttribute('aria-label')).toBe('模型与推理等级')
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 312, 240))
    await flushFrames()
    expect(popup.parentElement).toBe(document.body)
    expect(popup.style.position).toBe('fixed')
    expect(popup.style.top).toBe('136px')
    expect(popup.style.left).toBe('100px')
    expect(popup.style.maxHeight).not.toBe('')
    expect(popup.style.maxWidth).not.toBe('')
    expect(popup.style.boxSizing).toBe('border-box')

    const slider = screen.getByRole('slider', { name: '推理等级' }) as HTMLInputElement
    fireEvent.keyDown(slider, { key: 'End' })
    await waitFor(() => {
      expect(b.load).toHaveBeenCalledTimes(2)
      expect(b.select).toHaveBeenCalledWith({ provider: 'deepseek', model: 'chat', reasoningEffort: 'max' })
    })
  })

  it('keeps the character preference in a fixed footer outside an overflowing model catalog', async () => {
    ;(window as { __DSH_REASONING_EFFORT__?: unknown }).__DSH_REASONING_EFFORT__ = {
      preferencePath: '/plugins/dsh-reasoning-effort/preference',
      capabilityHeader: 'x-dsh-reasoning-effort-capability',
      capability: 'layout-test-capability',
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      chibiThumb: false,
      visualEfforts: {},
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const catalog = Array.from({ length: 40 }, (_value, index) => ({
      id: `model-${String(index + 1)}`,
      name: `Model ${String(index + 1)}`,
      reasoning: { efforts, defaultEffort: 'high' },
    }))
    const b = makeController([models({
      current: { provider: 'many', model: 'model-1', reasoningEffort: 'high' },
      groups: [{ id: 'many', name: 'Many Models', models: catalog }],
    })])
    renderControl(b.controller)

    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    await flushFrames()

    const scroll = await screen.findByTestId('reasoning-model-scroll')
    const footer = screen.getByTestId('reasoning-preference-footer')
    expect(within(scroll).getAllByRole('button')).toHaveLength(40)
    expect(scroll.nextElementSibling).toBe(footer)
    expect(within(footer).getByRole('switch', { name: /角色滑块/ })).toBeTruthy()
  })

  it('rejects a stale model route without selecting and restores the accepted value', async () => {
    const changedRoute = models({ current: { provider: 'deepseek', model: 'coder', reasoningEffort: 'low' } })
    const b = makeController([models(), changedRoute])
    renderControl(b.controller)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    await flushFrames()
    const slider = await screen.findByRole('slider', { name: '推理等级' }) as HTMLInputElement
    expect(slider.value).toBe('2')
    fireEvent.keyDown(slider, { key: 'End' })
    await screen.findByRole('alert')
    expect(b.select).not.toHaveBeenCalled()
    expect(slider.value).toBe('2')
    expect(screen.getByRole('alert').textContent).toContain('已变化')
  })

  it('revalidates that the exact target effort still exists in the latest Host snapshot', async () => {
    const removedTarget = models({
      groups: [{
        id: 'deepseek',
        name: 'DeepSeek',
        models: [{
          id: 'chat',
          name: 'DeepSeek Chat',
          reasoning: { efforts: efforts.slice(0, 2), defaultEffort: 'high' },
        }],
      }],
    })
    const b = makeController([models(), removedTarget])
    renderControl(b.controller)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    await flushFrames()
    const slider = await screen.findByRole('slider', { name: '推理等级' }) as HTMLInputElement
    fireEvent.keyDown(slider, { key: 'End' })
    expect((await screen.findByRole('alert')).textContent).toContain('该推理等级已变化')
    expect(b.select).not.toHaveBeenCalled()
    expect(slider.value).toBe('2')
  })

  it('rolls back a Host-rejected effort and exposes the failure in Harness chrome', async () => {
    const b = makeController([models(), models()])
    b.select.mockRejectedValueOnce(new Error('provider refused max'))
    renderControl(b.controller)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    await flushFrames()
    const slider = await screen.findByRole('slider', { name: '推理等级' }) as HTMLInputElement
    fireEvent.keyDown(slider, { key: 'End' })
    const error = await screen.findByRole('alert')
    expect(error.textContent).toContain('provider refused max')
    expect(slider.value).toBe('2')
  })

  it('rolls back a Host-rejected effort by stable ID after Host reorders the levels', async () => {
    const reordered = models({
      groups: [{
        id: 'deepseek',
        name: 'DeepSeek',
        models: [{
          id: 'chat',
          name: 'DeepSeek Chat',
          reasoning: { efforts: [efforts[1]!, efforts[0]!, efforts[2]!], defaultEffort: 'high' },
        }],
      }],
    })
    const b = makeController([models(), reordered])
    b.select.mockRejectedValueOnce(new Error('provider refused max'))
    renderControl(b.controller)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    await flushFrames()
    const slider = await screen.findByRole('slider', { name: '推理等级' }) as HTMLInputElement

    fireEvent.keyDown(slider, { key: 'End' })

    await screen.findByRole('alert')
    expect(slider.value).toBe('2')
    expect(slider.getAttribute('aria-valuetext')).toBe('High')
  })

  it('keeps the six-step Codex ladder visually clean while Ultra maps to High', async () => {
    const oneEffort = models({
      groups: [{
        id: 'deepseek',
        name: 'DeepSeek',
        models: [{
          id: 'chat',
          name: 'DeepSeek Chat',
          reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
        }],
      }],
    })
    const b = makeController([oneEffort])
    renderControl(b.controller)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    await flushFrames()
    expect(await screen.findByRole('dialog')).toBeTruthy()
    const slider = screen.getByRole('slider', { name: '推理等级' }) as HTMLInputElement
    expect(slider.min).toBe('0')
    expect(slider.max).toBe('5')
    expect(screen.getByText('模型上限 High')).toBeTruthy()
    fireEvent.keyDown(slider, { key: 'End' })
    await waitFor(() => {
      expect(b.select).toHaveBeenCalledWith({
        provider: 'deepseek',
        model: 'chat',
        reasoningEffort: 'high',
      })
    })
    expect(slider.getAttribute('aria-valuetext')).toBe('Ultra')
    expect(screen.queryByText(/实际 High/)).toBeNull()
    expect(screen.getAllByRole('button', { name: /DeepSeek Chat/ })).toHaveLength(2)

    fireEvent.keyDown(slider, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    const ultraTrigger = screen.getByRole('button', { name: /选择模型.*DeepSeek Chat.*Ultra/ })
    expect(ultraTrigger).toBeTruthy()
    fireEvent.click(ultraTrigger)
    await flushFrames()
    expect((await screen.findByRole('slider', { name: '推理等级' })).getAttribute('aria-valuetext')).toBe('Ultra')
  })

  it('restores a persisted Ultra visual choice after the session control remounts', async () => {
    const oneEffort = models({
      groups: [{
        id: 'deepseek',
        name: 'DeepSeek',
        models: [{
          id: 'chat',
          name: 'DeepSeek Chat',
          reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
        }],
      }],
    })
    const route = JSON.stringify(['session-a', 'deepseek', 'chat'])
    ;(window as { __DSH_REASONING_EFFORT__?: unknown }).__DSH_REASONING_EFFORT__ = {
      preferencePath: '/plugins/dsh-reasoning-effort/preference',
      capabilityHeader: 'x-dsh-reasoning-effort-capability',
      capability: 'test-capability',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ chibiThumb: false, visualEfforts: {} }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ chibiThumb: false, visualEfforts: { [route]: 5 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ chibiThumb: false, visualEfforts: { [route]: 5 } }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const b = makeController([oneEffort])
    const first = renderControl(b.controller, false, 'session-a' as SessionId)
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    await flushFrames()
    fireEvent.keyDown(await screen.findByRole('slider', { name: '推理等级' }), { key: 'End' })
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/plugins/dsh-reasoning-effort/preference', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ visualEffort: { route, index: 5 } }),
      }))
    })

    first.unmount()
    renderControl(b.controller, false, 'session-a' as SessionId)

    expect(await screen.findByRole('button', { name: /选择模型.*DeepSeek Chat.*Ultra/ })).toBeTruthy()
  })

  it('keeps an advertised Off reachable at Low while retaining the six visual stops', async () => {
    const withOff = models({
      current: { provider: 'deepseek', model: 'chat', reasoningEffort: 'off' },
      groups: [{
        id: 'deepseek',
        name: 'DeepSeek',
        models: [{
          id: 'chat',
          name: 'DeepSeek Chat',
          reasoning: {
            efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
            defaultEffort: 'high',
          },
        }],
      }],
    })
    const b = makeController([withOff, withOff])
    renderControl(b.controller)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    await flushFrames()
    const slider = await screen.findByRole('slider', { name: '推理等级' }) as HTMLInputElement
    expect(slider.max).toBe('5')
    expect(slider.value).toBe('0')
    expect(slider.getAttribute('aria-valuetext')).toBe('Low')
    expect(screen.queryByText(/实际 Off/)).toBeNull()
    fireEvent.keyDown(slider, { key: 'Home' })
    await waitFor(() => {
      expect(b.select).toHaveBeenCalledWith({ provider: 'deepseek', model: 'chat', reasoningEffort: 'off' })
    })
  })

  it('keeps unsupported models explicit instead of inventing a reasoning effort', async () => {
    const unsupported = models({
      groups: [{
        id: 'deepseek',
        name: 'DeepSeek',
        models: [{ id: 'chat', name: 'DeepSeek Chat' }],
      }],
    })
    const b = makeController([unsupported])
    renderControl(b.controller)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    await flushFrames()
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.getByText('当前模型不支持调节推理等级。')).toBeTruthy()
    expect(b.select).not.toHaveBeenCalled()
  })

  it('supports pointer and touch commits through the same exact Host validation', async () => {
    const b = makeController([models(), models(), models()])
    renderControl(b.controller)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    await flushFrames()
    const slider = await screen.findByRole('slider', { name: '推理等级' }) as HTMLInputElement
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 30))

    fireEvent.pointerDown(slider, { pointerId: 4, clientX: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(slider, { pointerId: 4, clientX: 100, pointerType: 'mouse' })
    await waitFor(() => { expect(b.select).toHaveBeenCalledTimes(1) })

    fireEvent.touchStart(slider, { touches: [{ clientX: 100 }] })
    fireEvent.touchMove(slider, { touches: [{ clientX: 0 }] })
    fireEvent.touchEnd(slider, { changedTouches: [{ clientX: 0 }] })
    await waitFor(() => { expect(b.select).toHaveBeenCalledTimes(2) })
    expect(b.select.mock.calls.map(call => call[0].reasoningEffort)).toEqual(['max', 'low'])
  })

  it('bridges Tab into the portal and closes by Escape or an outside pointer while restoring focus', async () => {
    const b = makeController()
    renderControl(b.controller)
    const trigger = screen.getByRole('button', { name: /选择模型/ })
    fireEvent.click(trigger)
    await flushFrames()
    const slider = await screen.findByRole('slider', { name: '推理等级' })
    fireEvent.keyDown(trigger, { key: 'Tab' })
    expect(document.activeElement).toBe(slider)

    fireEvent.keyDown(slider, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    await waitFor(() => { expect(document.activeElement).toBe(trigger) })

    fireEvent.click(trigger)
    await flushFrames()
    await screen.findByRole('dialog')
    fireEvent.pointerDown(document.body)
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('reads and writes only the exact Host preference bridge without localStorage', async () => {
    window.__DSH_REASONING_EFFORT__ = {
      preferencePath: '/plugins/dsh-reasoning-effort/preference',
      capabilityHeader: 'x-dsh-reasoning-effort-capability',
      capability: 'test-capability',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ chibiThumb: false, visualEfforts: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ chibiThumb: true, visualEfforts: {} }) })
    vi.stubGlobal('fetch', fetchMock)
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const b = makeController()
    renderControl(b.controller)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    await flushFrames()
    const toggle = await screen.findByRole('switch', { name: /角色滑块/ })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() => { expect(toggle.getAttribute('aria-checked')).toBe('true') })
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/plugins/dsh-reasoning-effort/preference', expect.objectContaining({
      method: 'GET',
      headers: { 'x-dsh-reasoning-effort-capability': 'test-capability' },
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/plugins/dsh-reasoning-effort/preference', expect.objectContaining({
      method: 'PUT',
      headers: {
        'x-dsh-reasoning-effort-capability': 'test-capability',
        'content-type': 'application/json',
      },
      body: '{"chibiThumb":true}',
    }))
    expect(storageSpy).not.toHaveBeenCalled()
  })
})
