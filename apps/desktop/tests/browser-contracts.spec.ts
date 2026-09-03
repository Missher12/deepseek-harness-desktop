import { describe, expect, it } from 'vitest'
import {
  isDesktopBrowserBounds, isDesktopBrowserRequest, normalizeBrowserTarget,
} from '../src/browser/contracts.ts'

describe('workbench Browser contracts', () => {
  it('accepts only finite visible bounds', () => {
    expect(isDesktopBrowserBounds({ x: 0, y: 0, width: 400, height: 300 })).toBe(true)
    expect(isDesktopBrowserBounds({ x: 0, y: 0, width: Number.NaN, height: 300 })).toBe(false)
    expect(isDesktopBrowserBounds({ x: 0, y: 0, width: 0, height: 300 })).toBe(false)
  })

  it('allows HTTP(S) navigation and rejects privileged schemes', () => {
    expect(isDesktopBrowserRequest({ kind: 'navigate', value: 'https://example.com' })).toBe(true)
    expect(isDesktopBrowserRequest({ kind: 'navigate', value: 'file:///tmp/a' })).toBe(false)
    expect(isDesktopBrowserRequest({ kind: 'navigate', value: 'javascript:alert(1)' })).toBe(false)
    expect(normalizeBrowserTarget('deepseek.com')).toBe('https://deepseek.com/')
  })
})
