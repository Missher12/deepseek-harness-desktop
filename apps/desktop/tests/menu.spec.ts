import type { MenuItem, MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createMenuTemplate } from '../src/window/menu.ts'

function itemWithAccelerator(
  template: readonly MenuItemConstructorOptions[],
  accelerator: string,
): MenuItemConstructorOptions | undefined {
  for (const item of template) {
    if (item.accelerator === accelerator) return item
    if (Array.isArray(item.submenu)) {
      const nested = itemWithAccelerator(item.submenu, accelerator)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

function hasRole(
  template: readonly MenuItemConstructorOptions[],
  role: MenuItemConstructorOptions['role'],
): boolean {
  return template.some(item => item.role === role
    || (Array.isArray(item.submenu) && hasRole(item.submenu, role)))
}

describe('createMenuTemplate', () => {
  it.each([
    ['CmdOrCtrl+N', 'new-session'],
    ['CmdOrCtrl+K', 'open-command-menu'],
    ['CmdOrCtrl+,', 'open-settings'],
  ] as const)('routes %s to %s', (accelerator, command) => {
    const send = vi.fn()
    const item = itemWithAccelerator(
      createMenuTemplate('DeepSeek Harness', send, 'darwin'),
      accelerator,
    )

    expect(item).toBeDefined()
    item?.click?.({} as MenuItem, undefined, {})
    expect(send).toHaveBeenCalledWith(command)
  })

  it('uses the application menu on macOS', () => {
    const template = createMenuTemplate('DeepSeek Harness', vi.fn(), 'darwin')

    expect(template[0]?.label).toBe('DeepSeek Harness')
    expect(hasRole(template, 'hide')).toBe(true)
  })

  it('uses standard File through Help menus on Windows', () => {
    const template = createMenuTemplate('DeepSeek Harness', vi.fn(), 'win32')

    expect(template.map(item => item.label)).toEqual(['File', 'Edit', 'View', 'Window', 'Help'])
    expect(itemWithAccelerator(template, 'CmdOrCtrl+N')).toBeDefined()
    expect(itemWithAccelerator(template, 'CmdOrCtrl+,')).toBeDefined()
    expect(hasRole(template, 'quit')).toBe(true)
    expect(hasRole(template, 'hide')).toBe(false)
  })

  it('mirrors approval-free Stop while control is active and never offers Pause', () => {
    const stop = vi.fn()
    const active = createMenuTemplate('DeepSeek Harness', vi.fn(), 'darwin', {
      controlActive: true,
      stopControl: stop,
    })
    const stopItem = active.flatMap(item => Array.isArray(item.submenu) ? item.submenu : [])
      .find(item => item.label === 'Stop Computer Control')
    expect(stopItem?.enabled).toBe(true)
    stopItem?.click?.({} as MenuItem, undefined, {})
    expect(stop).toHaveBeenCalledOnce()
    expect(JSON.stringify(active)).not.toMatch(/pause/i)

    const inactive = createMenuTemplate('DeepSeek Harness', vi.fn(), 'win32', {
      controlActive: false,
      stopControl: stop,
    })
    const disabled = inactive.flatMap(item => Array.isArray(item.submenu) ? item.submenu : [])
      .find(item => item.label === 'Stop Computer Control')
    expect(disabled?.enabled).toBe(false)
  })
})
