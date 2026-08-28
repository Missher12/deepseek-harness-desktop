import { describe, expect, it, vi } from 'vitest'
import { ComputerControlUiAuthority } from '../src/control/ui-authority.ts'
import { DEFAULT_CONTROL_SETTINGS, type ControlSettings } from '../src/control/settings-store.ts'

function setup(withProvider = true) {
  let settings: ControlSettings = {
    ...DEFAULT_CONTROL_SETTINGS,
    computerEnabled: true,
    ordinaryAppIds: ['app.notes'],
  }
  const write = vi.fn(async (next: ControlSettings) => { settings = next })
  const stop = vi.fn(async () => undefined)
  const authority = new ComputerControlUiAuthority({
    getSettings: () => settings,
    writeSettings: write,
    getControlStatus: () => ({
      computerSupported: withProvider,
      active: { surfaceKind: 'native-application', agentName: 'Agent', appId: 'app.notes' },
      action: 'computer.type',
      stopping: false,
    }),
    stopActive: stop,
    confirmExpansion: async () => true,
    ...(withProvider ? { provider: {
      status: async () => ({ viewing: 'granted' as const, assistive: 'denied' as const, supported: true }),
      list: async () => ({ apps: [
        { appId: 'app.notes', name: 'Notes', windows: [{ windowId: 'w1', title: 'Notes' }] },
        { appId: 'app.mail', name: 'Mail', windows: [{ windowId: 'w2', title: 'Inbox' }] },
      ] }),
    } } : {}),
  })
  return { authority, write, stop, getSettings: () => settings }
}

describe('ComputerControlUiAuthority', () => {
  it('projects permission/list/activity state without session or lease authority', async () => {
    const { authority } = setup()
    const snapshot = await authority.snapshot()
    expect(snapshot).toMatchObject({
      supported: true,
      permissions: { screenViewing: 'granted', assistiveControl: 'denied' },
      ordinaryApps: [
        { appId: 'app.notes', name: 'Notes', allowed: true },
        { appId: 'app.mail', name: 'Mail', allowed: false },
      ],
      active: { agentName: 'Agent', appName: 'Notes', action: 'Type' },
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/session|lease|windowId|ref/i)
  })

  it('fails a provider-less startup locally and never blocks status rendering', async () => {
    const { authority } = setup(false)
    await expect(authority.snapshot()).resolves.toMatchObject({
      supported: false,
      permissions: { screenViewing: 'unknown', assistiveControl: 'unknown' },
      ordinaryApps: [],
    })
  })

  it('allows only enumerated app expansion and awaits the global stop path', async () => {
    const { authority, write, stop, getSettings } = setup()
    await authority.mutate({ kind: 'set-app-allowed', appId: 'app.mail', allowed: true })
    expect(getSettings().ordinaryAppIds).toEqual(['app.notes', 'app.mail'])
    await expect(authority.mutate({ kind: 'set-app-allowed', appId: 'app.unknown', allowed: true })).rejects.toThrow(/enumerated/i)
    expect(write).toHaveBeenCalledTimes(1)
    await authority.stop()
    expect(stop).toHaveBeenCalledOnce()
  })
})
