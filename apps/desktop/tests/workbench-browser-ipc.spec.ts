import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  let exposedApi: unknown
  return {
    contextBridge: {
      exposeInMainWorld: vi.fn((_name: string, api: unknown) => { exposedApi = api }),
    },
    invoke: vi.fn(async () => undefined),
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      send: vi.fn(),
    },
    exposedApi: () => exposedApi,
  }
})

electron.ipcRenderer.invoke = electron.invoke

vi.mock('electron', () => ({
  contextBridge: electron.contextBridge,
  ipcRenderer: electron.ipcRenderer,
}))

import '../src/preload.ts'

interface UnsafeWorkbenchBrowserApi {
  showWorkbenchBrowser: (...args: unknown[]) => Promise<unknown>
  layoutWorkbenchBrowser: (...args: unknown[]) => Promise<void>
  setWorkbenchBrowserDockVisibility: (...args: unknown[]) => Promise<void>
  hideWorkbenchBrowser: (...args: unknown[]) => Promise<void>
  controlWorkbenchBrowser: (...args: unknown[]) => Promise<unknown>
}

function workbenchBrowserApi(): UnsafeWorkbenchBrowserApi {
  const exposed = electron.exposedApi()
  if (typeof exposed !== 'object' || exposed === null) throw new Error('Desktop preload API was not exposed.')
  return exposed as UnsafeWorkbenchBrowserApi
}

beforeEach(() => { electron.invoke.mockClear() })

describe('Workbench Browser preload IPC boundary', () => {
  it('forwards exactly one boolean visibility argument', async () => {
    const api = workbenchBrowserApi()

    await expect(api.setWorkbenchBrowserDockVisibility(true)).resolves.toBeUndefined()
    expect(electron.invoke).toHaveBeenCalledWith('desktop:workbench-browser-dock-visibility', true)

    electron.invoke.mockClear()
    await expect(api.setWorkbenchBrowserDockVisibility()).rejects.toThrow(/one boolean/u)
    await expect(api.setWorkbenchBrowserDockVisibility(false, true)).rejects.toThrow(/one boolean/u)
    await expect(api.setWorkbenchBrowserDockVisibility('false')).rejects.toThrow(/one boolean/u)
    expect(electron.invoke).not.toHaveBeenCalled()
  })

  it('forwards hide only when the caller supplies no arguments', async () => {
    const api = workbenchBrowserApi()

    await expect(api.hideWorkbenchBrowser()).resolves.toBeUndefined()
    expect(electron.invoke).toHaveBeenCalledWith('desktop:workbench-browser-hide')

    electron.invoke.mockClear()
    await expect(api.hideWorkbenchBrowser(undefined)).rejects.toThrow(/no arguments/u)
    await expect(api.hideWorkbenchBrowser({ rendererAuthority: true })).rejects.toThrow(/no arguments/u)
    expect(electron.invoke).not.toHaveBeenCalled()
  })

  it('rejects extra arguments for every one-value Browser method', async () => {
    const api = workbenchBrowserApi()
    const bounds = { x: 1, y: 2, width: 640, height: 480 }
    const request = { kind: 'reload' }

    await expect(api.showWorkbenchBrowser(bounds, { rendererAuthority: true })).rejects.toThrow(/bounds/u)
    await expect(api.layoutWorkbenchBrowser(bounds, undefined)).rejects.toThrow(/bounds/u)
    await expect(api.controlWorkbenchBrowser(request, { approved: true })).rejects.toThrow(/request/u)
    expect(electron.invoke).not.toHaveBeenCalled()
  })
})

describe('Workbench Browser main IPC boundary', () => {
  it('rejects extra arguments at every privileged Browser receiver', () => {
    const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    const handlerSource = (channel: string): string => {
      const start = source.indexOf(`ipcMain.handle('${channel}'`)
      const candidates = [
        source.indexOf('\nipcMain.handle(', start + 1),
        source.indexOf('\nconst removeBrowserTakeoverIpc', start + 1),
      ].filter(index => index > start)
      const end = Math.min(...candidates)
      if (start < 0 || !Number.isFinite(end)) throw new Error(`Missing main IPC handler: ${channel}`)
      return source.slice(start, end)
    }
    const visibility = handlerSource('desktop:workbench-browser-dock-visibility')
    const hide = handlerSource('desktop:workbench-browser-hide')
    const show = handlerSource('desktop:workbench-browser-show')
    const layout = handlerSource('desktop:workbench-browser-layout')
    const control = handlerSource('desktop:workbench-browser-control')

    expect(visibility).toContain('(event, ...args: unknown[]) => {')
    expect(visibility).toContain("args.length !== 1 || typeof args[0] !== 'boolean'")
    expect(hide).toContain('(event, ...args: unknown[]) => {')
    expect(hide).toContain('args.length !== 0')
    for (const handler of [show, layout, control]) {
      expect(handler).toContain('(event, ...args: unknown[]) => {')
      expect(handler).toContain('args.length !== 1')
    }
  })
})
