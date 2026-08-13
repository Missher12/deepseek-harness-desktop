import { describe, expect, it } from 'vitest'
import { createWindowOptions } from '../src/window/options.ts'

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
    )

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
})
