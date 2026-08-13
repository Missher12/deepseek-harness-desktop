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

describe('createMenuTemplate', () => {
  it.each([
    ['CmdOrCtrl+N', 'new-session'],
    ['CmdOrCtrl+K', 'open-command-menu'],
    ['CmdOrCtrl+,', 'open-settings'],
  ] as const)('routes %s to %s', (accelerator, command) => {
    const send = vi.fn()
    const item = itemWithAccelerator(createMenuTemplate('DeepSeek Harness', send), accelerator)

    expect(item).toBeDefined()
    item?.click?.({} as MenuItem, undefined, {})
    expect(send).toHaveBeenCalledWith(command)
  })
})
