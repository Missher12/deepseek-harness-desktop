import { describe, expect, it } from 'vitest'
import * as windowOptions from '../src/window/options.ts'

const { createWindowOptions, selectWindowsTrayIconSize } = windowOptions

describe('createWindowOptions', () => {
  it('enables the hardened persistent desktop renderer', () => {
    const options = createWindowOptions(
      { x: 80, y: 50, width: 1200, height: 760 },
      '/app/lib/preload.js',
      'darwin',
    )

    expect(options).toMatchObject({
      x: 80,
      y: 50,
      width: 1200,
      height: 760,
      minWidth: 900,
      minHeight: 620,
      show: false,
      titleBarStyle: 'hiddenInset',
      webPreferences: {
        preload: '/app/lib/preload.js',
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        partition: 'persist:dsh-desktop',
      },
    })
  })

  it('uses the standard native frame on Windows', () => {
    const options = createWindowOptions(
      { x: 80, y: 50, width: 1200, height: 760 },
      'C:\\app\\lib\\preload.cjs',
      'win32',
      'C:\\app\\assets\\icon-windows.ico',
    )

    expect(options.icon).toBe('C:\\app\\assets\\icon-windows.ico')
    expect(options.titleBarStyle).toBeUndefined()
    expect(options.trafficLightPosition).toBeUndefined()
    expect(options.webPreferences).toMatchObject({
      preload: 'C:\\app\\lib\\preload.cjs',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    })
  })

  it('fails loud if a Windows BrowserWindow icon is missing', () => {
    expect(() => createWindowOptions(
      { x: 80, y: 50, width: 1200, height: 760 },
      'C:\\app\\lib\\preload.cjs',
      'win32',
    )).toThrow(/Windows.*icon/u)
  })

  it.each([
    [1, 16],
    [1.25, 20],
    [1.5, 24],
    [1.75, 32],
    [2, 32],
    [3, 32],
  ])('selects a %sx Windows tray asset at %s pixels', (scaleFactor, expected) => {
    expect(selectWindowsTrayIconSize(scaleFactor)).toBe(expected)
  })

  it('marks only the macOS hidden-inset renderer URL', () => {
    const desktopRendererUrl = (windowOptions as {
      desktopRendererUrl?: (url: string, platform: NodeJS.Platform) => string
    }).desktopRendererUrl
    expect(desktopRendererUrl).toBeTypeOf('function')
    if (desktopRendererUrl === undefined) return

    const root = 'http://127.0.0.1:45678/?surface=desktop&titlebar=hidden-inset'
    const macUrl = new URL(desktopRendererUrl(root, 'darwin'))
    const windowsUrl = new URL(desktopRendererUrl(root, 'win32'))

    expect(macUrl.searchParams.get('titlebar')).toBe('hidden-inset')
    expect(windowsUrl.searchParams.get('surface')).toBe('desktop')
    expect(windowsUrl.searchParams.has('titlebar')).toBe(false)
  })
})
