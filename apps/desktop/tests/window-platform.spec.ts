import { describe, expect, it } from 'vitest'
import { desktopPlatformBehavior } from '../src/window/platform.ts'

describe('desktopPlatformBehavior', () => {
  it('keeps close-to-Dock and Dock icon behavior on macOS', () => {
    expect(desktopPlatformBehavior('darwin')).toEqual({
      hideWindowOnClose: true,
      setDockIcon: true,
    })
  })

  it('quits on close and avoids Dock APIs on Windows', () => {
    expect(desktopPlatformBehavior('win32')).toEqual({
      hideWindowOnClose: false,
      setDockIcon: false,
    })
  })
})
