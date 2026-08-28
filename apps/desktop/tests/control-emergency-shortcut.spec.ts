import { describe, expect, it } from 'vitest'
import { EmergencyShortcutController } from '../src/control/emergency-shortcut.ts'

class FakeShortcuts {
  readonly callbacks = new Map<string, () => void>()
  readonly history: string[] = []
  fail = false
  error: Error | undefined

  register(accelerator: string, callback: () => void): boolean {
    this.history.push(`register:${accelerator}`)
    if (this.error !== undefined) throw this.error
    if (this.fail || this.callbacks.has(accelerator)) return false
    this.callbacks.set(accelerator, callback)
    return true
  }

  unregister(accelerator: string): void {
    this.history.push(`unregister:${accelerator}`)
    this.callbacks.delete(accelerator)
  }
}

describe('emergency shortcut authority', () => {
  it('registers only for an active lease and fails a grant closed when registration fails', () => {
    const shortcuts = new FakeShortcuts()
    let active = false
    const order: string[] = []
    const controller = new EmergencyShortcutController({
      shortcuts,
      isLeaseActive: () => active,
      closeAdmission: () => { order.push('admission-closed') },
      revokeSynchronously: () => { order.push('revoked') },
      stopAll: async () => { order.push('stopped') },
    })
    expect(() => { controller.activate('CommandOrControl+Shift+F12') }).toThrow(/active lease/i)
    expect(shortcuts.history).toEqual([])
    active = true
    shortcuts.fail = true
    expect(() => { controller.activate('CommandOrControl+Shift+F12') }).toThrow(/register/i)
    expect(order).toEqual(['admission-closed', 'revoked'])
  })

  it('fails a grant closed when Electron shortcut registration throws', () => {
    const shortcuts = new FakeShortcuts()
    shortcuts.error = new Error('registration threw')
    const order: string[] = []
    const controller = new EmergencyShortcutController({
      shortcuts,
      isLeaseActive: () => true,
      closeAdmission: () => { order.push('admission-closed') },
      revokeSynchronously: () => { order.push('revoked') },
      stopAll: async () => { order.push('stopped') },
    })

    expect(() => {
      controller.activate('CommandOrControl+Shift+F12')
    }).toThrow(/register/i)
    expect(order).toEqual(['admission-closed', 'revoked'])
  })

  it('registers a replacement before exact old-key removal and ignores stale callbacks', async () => {
    const shortcuts = new FakeShortcuts()
    const order: string[] = []
    const controller = new EmergencyShortcutController({
      shortcuts,
      isLeaseActive: () => true,
      closeAdmission: () => { order.push('admission-closed') },
      revokeSynchronously: () => { order.push('revoked') },
      stopAll: async () => { order.push('stopped') },
    })
    controller.activate('F11')
    const stale = shortcuts.callbacks.get('F11')!
    controller.rebind('F12')
    expect(shortcuts.history).toEqual(['register:F11', 'register:F12', 'unregister:F11'])
    stale()
    expect(order).toEqual([])
    shortcuts.callbacks.get('F12')!()
    expect(order).toEqual(['admission-closed', 'revoked'])
    await controller.waitForStop()
    expect(order).toEqual(['admission-closed', 'revoked', 'stopped'])
    controller.deactivate()
    expect(shortcuts.history.at(-1)).toBe('unregister:F12')
  })

  it('keeps the owned old shortcut when an atomic rebind registration fails', () => {
    const shortcuts = new FakeShortcuts()
    const controller = new EmergencyShortcutController({
      shortcuts,
      isLeaseActive: () => true,
      closeAdmission: () => {},
      revokeSynchronously: () => {},
      stopAll: async () => {},
    })
    controller.activate('F11')
    shortcuts.fail = true
    expect(() => { controller.rebind('F12') }).toThrow(/register/i)
    expect(shortcuts.callbacks.has('F11')).toBe(true)
    expect(shortcuts.history).not.toContain('unregister:F11')
  })

  it('keeps awaited stop failures observable after synchronous authority revocation', async () => {
    const shortcuts = new FakeShortcuts()
    const controller = new EmergencyShortcutController({
      shortcuts,
      isLeaseActive: () => true,
      closeAdmission: () => {},
      revokeSynchronously: () => {},
      stopAll: async () => { throw new Error('cleanup failed') },
    })
    controller.activate('F12')
    shortcuts.callbacks.get('F12')!()
    await expect(controller.waitForStop()).rejects.toThrow('cleanup failed')
  })
})
