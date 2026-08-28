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
  const confirm = vi.fn(async () => true)
  const authority = new ComputerControlUiAuthority({
    getSettings: () => settings,
    writeSettings: write,
    getControlStatus: () => ({
      browserSupported: true,
      computerSupported: withProvider,
      active: { surfaceKind: 'native-application', agentName: 'Agent', appId: 'app.notes' },
      action: 'computer.type',
      stopping: false,
    }),
    stopActive: stop,
    confirmExpansion: confirm,
    ...(withProvider ? { provider: {
      status: async () => ({ viewing: 'granted' as const, assistive: 'denied' as const, supported: true }),
      list: async () => ({ apps: [
        { appId: 'app.notes', name: 'Notes', windows: [{ windowId: 'w1', title: 'Notes' }] },
        { appId: 'app.mail', name: 'Mail', windows: [{ windowId: 'w2', title: 'Inbox' }] },
      ] }),
    } } : {}),
  })
  return { authority, write, stop, confirm, getSettings: () => settings }
}

describe('ComputerControlUiAuthority', () => {
  it('projects permission/list/activity state without session or lease authority', async () => {
    const { authority } = setup()
    const snapshot = await authority.snapshot()
    expect(snapshot).toMatchObject({
      browser: { availability: 'available', enabled: false },
      computer: { availability: 'available', enabled: true },
      permissions: { screenViewing: 'granted', assistiveControl: 'denied' },
      refresh: { status: { state: 'ready' }, apps: { state: 'ready' } },
      ordinaryApps: [
        { appId: 'app.notes', name: 'Notes', allowed: true },
        { appId: 'app.mail', name: 'Mail', allowed: false },
      ],
      active: { agentName: 'Agent', appName: 'Notes', action: 'Type' },
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/"(?:sessionId|leaseId|windowId|ref)"/i)
  })

  it('persists browser enablement only after the main-owned confirmation', async () => {
    const { authority, write, confirm, getSettings } = setup()
    await authority.mutate({ kind: 'set-browser-enabled', enabled: true })

    expect(confirm).toHaveBeenCalledWith({ kind: 'set-browser-enabled', enabled: true })
    expect(getSettings().browserEnabled).toBe(true)

    confirm.mockClear()
    await authority.mutate({ kind: 'set-browser-enabled', enabled: false })
    expect(confirm).not.toHaveBeenCalled()
    expect(getSettings().browserEnabled).toBe(false)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('keeps browser control disabled when native confirmation is declined', async () => {
    const { authority, write, confirm, getSettings } = setup()
    confirm.mockResolvedValueOnce(false)

    await expect(authority.mutate({ kind: 'set-browser-enabled', enabled: true }))
      .rejects.toThrow(/not confirmed/i)
    expect(getSettings().browserEnabled).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('fails a provider-less startup locally and never blocks status rendering', async () => {
    const { authority } = setup(false)
    await expect(authority.snapshot()).resolves.toMatchObject({
      browser: { availability: 'available', enabled: false },
      computer: { availability: 'unavailable', enabled: true },
      permissions: { screenViewing: 'unknown', assistiveControl: 'unknown' },
      refresh: { status: { state: 'ready' }, apps: { state: 'ready' } },
      ordinaryApps: [],
    })
  })

  it('settles native status and application enumeration independently', async () => {
    let settings: ControlSettings = { ...DEFAULT_CONTROL_SETTINGS }
    const status = vi.fn()
      .mockResolvedValueOnce({ viewing: 'granted', assistive: 'granted', supported: true })
      .mockRejectedValueOnce(new Error('private status detail'))
    const list = vi.fn()
      .mockResolvedValueOnce({ apps: [{
        appId: 'app.notes', name: 'Notes', windows: [{ windowId: 'w1', title: 'Notes' }],
      }] })
      .mockRejectedValueOnce(new Error('private list detail'))
    const authority = new ComputerControlUiAuthority({
      getSettings: () => settings,
      writeSettings: async (next) => { settings = next },
      getControlStatus: () => ({
        browserSupported: true, computerSupported: true, active: null, action: null, stopping: false,
      }),
      stopActive: async () => undefined,
      confirmExpansion: async () => true,
      provider: { status, list },
    })

    const first = await authority.snapshot()
    expect(first.ordinaryApps).toEqual([{ appId: 'app.notes', name: 'Notes', allowed: false }])
    const second = await authority.snapshot()
    expect(second).toMatchObject({
      browser: { availability: 'available' },
      computer: { availability: 'available' },
      permissions: { screenViewing: 'granted', assistiveControl: 'granted' },
      refresh: {
        status: { state: 'failed', message: 'Computer status could not be refreshed.' },
        apps: { state: 'failed', message: 'Applications could not be refreshed.' },
      },
      ordinaryApps: [{ appId: 'app.notes', name: 'Notes', allowed: false }],
    })
    expect(JSON.stringify(second)).not.toContain('private')
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
