import { describe, expect, it } from 'vitest'
import { createWindowOptions } from '../src/window/options.ts'

describe('createWindowOptions', () => {
  it('enables the hardened persistent desktop renderer', () => {
    const options = createWindowOptions(
      { x: 80, y: 50, width: 1200, height: 760 },
      '/app/lib/preload.js',
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
})
