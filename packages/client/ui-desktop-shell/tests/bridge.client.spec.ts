// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchDesktopCommand, installPresentation } from '../src/client/bridge.ts'
import { isDesktopShellBridge } from '../src/client/contracts.ts'

afterEach(() => {
  document.body.replaceChildren()
  document.head.querySelectorAll('[data-dsh-native-shell]').forEach((element) => { element.remove() })
  delete document.body.dataset.dshSurface
  delete document.body.dataset.dshTitlebar
})

describe('native shell binding', () => {
  it('rejects incomplete preload faces and invalid native presentation', () => {
    const valid = { presentation: { titlebar: 'native' }, onCommand() {}, getDesktopPreferences() {}, setDesktopPreference() {}, onDesktopPreferences() {} }
    expect(isDesktopShellBridge(valid)).toBe(true)
    for (const field of ['onCommand', 'getDesktopPreferences', 'setDesktopPreference', 'onDesktopPreferences']) {
      expect(isDesktopShellBridge({ ...valid, [field]: undefined })).toBe(false)
    }
    for (const presentation of [null, [], { titlebar: 'remote' }, { titlebar: 'native', extra: true }]) {
      expect(isDesktopShellBridge({ ...valid, presentation })).toBe(false)
    }
    expect(isDesktopShellBridge(null)).toBe(false)
  })
  it('reserves the hidden titlebar and restores preexisting DOM state on removal', () => {
    document.body.dataset.dshSurface = 'previous'
    const clean = installPresentation(document, { titlebar: 'hidden-inset' })
    expect(document.body.dataset.dshSurface).toBe('desktop')
    expect(document.body.dataset.dshTitlebar).toBe('hidden-inset')
    expect(document.head.querySelector('style[data-dsh-native-shell]')?.textContent).toContain('-webkit-app-region: drag')
    clean()
    expect(document.body.dataset.dshSurface).toBe('previous')
    expect(document.body.dataset.dshTitlebar).toBeUndefined()
    expect(document.head.querySelector('[data-dsh-native-shell]')).toBeNull()
  })
  it('uses native titlebars without adding a drag strip', () => {
    const clean = installPresentation(document, { titlebar: 'native' })
    expect(document.body.dataset.dshSurface).toBe('desktop')
    expect(document.head.querySelector('[data-dsh-native-shell]')).toBeNull()
    clean()
  })
  it('uses navigation for a new session and the mounted trigger for settings', () => {
    const startSession = vi.fn()
    const settings = document.createElement('button')
    const click = vi.fn()
    settings.addEventListener('click', click)
    document.body.append(settings)
    const commands = { startSession, settingsButton: () => settings, searchLabel: () => 'Search sessions' }
    expect(dispatchDesktopCommand('new-session', document, commands)).toBe(true)
    expect(startSession).toHaveBeenCalledOnce()
    expect(dispatchDesktopCommand('open-settings', document, commands)).toBe(true)
    expect(click).toHaveBeenCalledOnce()
    settings.remove()
    expect(dispatchDesktopCommand('open-settings', document, commands)).toBe(false)
    expect(dispatchDesktopCommand('delete-everything', document, commands)).toBe(false)
  })
  it('opens only a unique search button and resolves its current locale on every command', () => {
    let label = 'Search sessions'
    const commands = { startSession() {}, settingsButton: () => null, searchLabel: () => label }
    expect(dispatchDesktopCommand('open-command-menu', document, commands)).toBe(false)
    const button = document.createElement('button')
    button.setAttribute('aria-label', label)
    document.body.append(button)
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    expect(dispatchDesktopCommand('open-command-menu', document, commands)).toBe(true)
    const duplicate = button.cloneNode() as HTMLButtonElement
    document.body.append(duplicate)
    expect(dispatchDesktopCommand('open-command-menu', document, commands)).toBe(false)
    expect(clicked).toHaveBeenCalledTimes(1)
    duplicate.remove()
    label = '搜索会话'
    expect(dispatchDesktopCommand('open-command-menu', document, commands)).toBe(false)
    button.setAttribute('aria-label', label)
    expect(dispatchDesktopCommand('open-command-menu', document, commands)).toBe(true)
    expect(clicked).toHaveBeenCalledTimes(2)
  })
})
