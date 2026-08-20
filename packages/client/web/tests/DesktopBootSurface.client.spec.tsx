// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopBootSurface, isMacDesktopSurface } from '../src/DesktopBootSurface.tsx'

afterEach(cleanup)

describe('DesktopBootSurface', () => {
  it('keeps an accessible indeterminate progress bar throughout the healthy hold', () => {
    const view = render(<DesktopBootSurface phase="hold" failed={[]} />)
    const progress = screen.getByRole('progressbar', { name: '正在启动' })
    expect(progress.getAttribute('aria-valuenow')).toBeNull()
    expect(progress.getAttribute('aria-valuetext')).toBe('正在初始化桌面运行时')

    view.rerender(<DesktopBootSurface phase="exit" failed={[]} />)
    expect(screen.getByRole('progressbar', { name: '正在启动' })).toBe(progress)
  })

  it('shows failures instead of claiming startup progress', () => {
    render(<DesktopBootSurface phase="hold" failed={[['plugin-id', 'failed']]} error="settlement failed" />)
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByText('plugin-id')).toBeTruthy()
    expect(screen.getByText('settlement failed')).toBeTruthy()
  })

  it('activates only for the explicit macOS Desktop surface', () => {
    expect(isMacDesktopSurface('?surface=desktop', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe(true)
    expect(isMacDesktopSurface('?surface=desktop', 'Mozilla/5.0 (Windows NT 10.0)')).toBe(false)
    expect(isMacDesktopSurface('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe(false)
  })
})
