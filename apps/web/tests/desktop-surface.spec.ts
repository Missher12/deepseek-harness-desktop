// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installDesktopSurface } from '../src/desktop-surface.ts'

describe('desktop surface bridge', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    delete document.body.dataset.dshSurface
    delete document.body.dataset.dshTitlebar
  })

  it('leaves the browser surface untouched without the desktop marker or bridge', () => {
    const dispose = installDesktopSurface(new URL('http://127.0.0.1:65000/'))

    expect(document.body.dataset.dshSurface).toBeUndefined()
    dispose()
  })

  it('marks the desktop surface from the preload bridge after the token-exchange redirect', () => {
    const onCommand = vi.fn()

    // The alpha.5 auth flow lands on the bare root: no surface query remains.
    const dispose = installDesktopSurface(new URL('http://127.0.0.1:65000/'), {
      onCommand,
      presentation: { titlebar: 'hidden-inset' },
    })

    expect(document.body.dataset.dshSurface).toBe('desktop')
    expect(document.body.dataset.dshTitlebar).toBe('hidden-inset')
    dispose()
    expect(document.body.dataset.dshSurface).toBeUndefined()
    expect(document.body.dataset.dshTitlebar).toBeUndefined()
  })

  it('lets the trusted native presentation override a stale URL marker', () => {
    const dispose = installDesktopSurface(new URL(
      'http://127.0.0.1:65000/?surface=desktop&titlebar=hidden-inset',
    ), {
      onCommand: () => () => undefined,
      presentation: { titlebar: 'native' },
    })

    expect(document.body.dataset.dshSurface).toBe('desktop')
    expect(document.body.dataset.dshTitlebar).toBeUndefined()
    dispose()
  })

  it('fails closed when a preload bridge exposes an invalid presentation', () => {
    const dispose = installDesktopSurface(new URL(
      'http://127.0.0.1:65000/?surface=desktop&titlebar=hidden-inset',
    ), {
      onCommand: () => () => undefined,
      presentation: { titlebar: 'overlay' },
    })

    expect(document.body.dataset.dshSurface).toBe('desktop')
    expect(document.body.dataset.dshTitlebar).toBeUndefined()
    dispose()
  })

  it('maps the closed native command vocabulary onto explicit controls', () => {
    const clicks = {
      'new-session': vi.fn(),
      'open-command-menu': vi.fn(),
      'open-settings': vi.fn(),
    }
    for (const [command, onClick] of Object.entries(clicks)) {
      const button = document.createElement('button')
      button.dataset.dshDesktopCommand = command
      button.addEventListener('click', onClick)
      document.body.append(button)
    }
    let listener: ((command: unknown) => void) | undefined
    const unsubscribe = vi.fn()

    const dispose = installDesktopSurface(new URL('http://127.0.0.1:65000/?surface=desktop'), {
      presentation: { titlebar: 'native' },
      onCommand: (next) => {
        listener = next
        return unsubscribe
      },
    })

    expect(document.body.dataset.dshSurface).toBe('desktop')
    listener?.('new-session')
    listener?.('open-command-menu')
    listener?.('open-settings')
    listener?.('hostile-command')
    expect(clicks['new-session']).toHaveBeenCalledOnce()
    expect(clicks['open-command-menu']).toHaveBeenCalledOnce()
    expect(clicks['open-settings']).toHaveBeenCalledOnce()

    dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(document.body.dataset.dshSurface).toBeUndefined()
  })

  it('marks the desktop surface even when no native bridge is present', () => {
    const dispose = installDesktopSurface(new URL('http://127.0.0.1:65000/?surface=desktop'))

    expect(document.body.dataset.dshSurface).toBe('desktop')
    expect(document.body.dataset.dshTitlebar).toBeUndefined()
    dispose()
  })

  it('reserves a renderer title bar only for the explicit hidden-inset window', () => {
    const dispose = installDesktopSurface(new URL(
      'http://127.0.0.1:65000/?surface=desktop&titlebar=hidden-inset',
    ))

    expect(document.body.dataset.dshSurface).toBe('desktop')
    expect(document.body.dataset.dshTitlebar).toBe('hidden-inset')

    dispose()
    expect(document.body.dataset.dshTitlebar).toBeUndefined()
  })
})
