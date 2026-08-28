import { describe, expect, it, vi } from 'vitest'
import {
  AgentBrowserUrlPolicy,
  classifyBrowserTarget,
  createBrowserSecurityHandlerOwner,
  installBrowserSecurityHandlers,
} from '../src/browser/policy.ts'

class FakeEventTarget {
  readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  on(event: string, listener: (...args: unknown[]) => void): this {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  removeListener(event: string, listener: (...args: unknown[]) => void): this {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

class FakePolicyContents extends FakeEventTarget {
  windowOpenHandler: ((details: { url: string }) => { action: 'allow' | 'deny' }) | undefined
  windowOpenSetterCalls = 0

  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }): void {
    this.windowOpenSetterCalls += 1
    this.windowOpenHandler = handler
  }
}

class FakePolicySession extends FakeEventTarget {
  permissionCheckHandler: ((...args: unknown[]) => boolean) | null = null
  permissionRequestHandler: ((contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) | null = null
  permissionCheckSetterCalls = 0
  permissionRequestSetterCalls = 0

  setPermissionCheckHandler(handler: ((...args: unknown[]) => boolean) | null): void {
    this.permissionCheckSetterCalls += 1
    this.permissionCheckHandler = handler
  }

  setPermissionRequestHandler(
    handler: ((contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) | null,
  ): void {
    this.permissionRequestSetterCalls += 1
    this.permissionRequestHandler = handler
  }
}

function ownerFor(contents: FakePolicyContents, session: FakePolicySession) {
  return createBrowserSecurityHandlerOwner({
    contents,
    session,
    baseWindowOpenHandler: () => ({ action: 'allow' }),
    basePermissionCheckHandler: () => true,
    basePermissionRequestHandler: (_contents, _permission, callback) => { callback(true) },
  })
}

describe('Agent browser policy', () => {
  it.each([
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.8/',
    'http://172.20.0.1/',
    'http://192.168.1.1/',
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[fec0::1]/',
    'http://[::ffff:7f00:1]/',
    'http://localhost/',
    'http://localhost./',
  ])('rejects literal private destination %s', async (url) => {
    const policy = new AgentBrowserUrlPolicy({ lookup: async () => ['93.184.216.34'] })
    await expect(policy.authorize(url)).rejects.toMatchObject({ code: 'POLICY_DENIED' })
  })

  it('rejects userinfo and DNS answers that resolve to private space', async () => {
    const policy = new AgentBrowserUrlPolicy({ lookup: async () => ['93.184.216.34', '10.2.3.4'] })
    await expect(policy.authorize('https://user:secret@example.test/')).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    })
    await expect(policy.authorize('https://example.test/')).rejects.toMatchObject({ code: 'POLICY_DENIED' })
  })

  it('checks every destination independently and permits an explicit user allowlist override', async () => {
    const seen: string[] = []
    const policy = new AgentBrowserUrlPolicy({
      lookup: async (hostname) => {
        seen.push(hostname)
        return hostname === 'public.test' ? ['93.184.216.34'] : ['192.168.2.4']
      },
      allowPrivateDestination: (url, address) => url.hostname === 'allowed.test' && address === '192.168.2.4',
    })

    await expect(policy.authorize('https://public.test/start')).resolves.toBe('https://public.test/start')
    await expect(policy.authorize('https://private.test/redirect')).rejects.toMatchObject({ code: 'POLICY_DENIED' })
    await expect(policy.authorize('https://allowed.test/redirect')).resolves.toBe('https://allowed.test/redirect')
    expect(seen).toEqual(['public.test', 'private.test', 'allowed.test'])
  })

  it('fails closed on malformed resolver output and lets an explicit user allowlist cover localhost', async () => {
    const malformed = new AgentBrowserUrlPolicy({ lookup: async () => ['not-an-ip-address'] })
    await expect(malformed.authorize('https://example.test/')).rejects.toMatchObject({ code: 'POLICY_DENIED' })

    const allowlisted = new AgentBrowserUrlPolicy({
      lookup: async () => { throw new Error('localhost must not escape through DNS') },
      allowPrivateDestination: (url, address) => url.hostname === 'localhost' && address === 'localhost',
    })
    await expect(allowlisted.authorize('http://localhost/')).resolves.toBe('http://localhost/')
  })

  it('denies secure, OTP, payment, file, upload, disabled, readonly, and uncertain editable targets', () => {
    const base = { role: 'textbox', name: 'ordinary field', editable: true } as const
    expect(classifyBrowserTarget({ ...base, type: 'password' })).toBe('DENY')
    expect(classifyBrowserTarget({ ...base, type: 'text', autocomplete: 'one-time-code' })).toBe('DENY')
    expect(classifyBrowserTarget({ ...base, type: 'text', autocomplete: 'cc-number' })).toBe('DENY')
    expect(classifyBrowserTarget({ ...base, type: 'file' })).toBe('DENY')
    expect(classifyBrowserTarget({ ...base, type: 'text', name: 'Upload identity document' })).toBe('DENY')
    expect(classifyBrowserTarget({ ...base, type: 'text', name: 'Card CVV' })).toBe('DENY')
    expect(classifyBrowserTarget({ ...base, type: 'text', disabled: true })).toBe('DENY')
    expect(classifyBrowserTarget({ ...base, type: 'text', readonly: true })).toBe('DENY')
    expect(classifyBrowserTarget(base)).toBe('DENY')
    expect(classifyBrowserTarget({ ...base, type: 'text', autocomplete: 'off' })).toBe('ALLOW')
    expect(classifyBrowserTarget({ role: 'button', name: 'Upload file', editable: false })).toBe('DENY')
    expect(classifyBrowserTarget({ role: 'button', name: 'Continue', editable: false })).toBe('ALLOW')
  })

  it('denies popups, downloads, navigation escapes, and every permission', () => {
    const contents = new FakePolicyContents()
    const session = new FakePolicySession()
    const owner = ownerFor(contents, session)
    const registration = installBrowserSecurityHandlers({
      owner,
      generation: 1,
      allowsNavigation: url => url === 'https://allowed.test/',
    })

    expect(contents.windowOpenHandler?.({ url: 'https://allowed.test/' })).toEqual({ action: 'deny' })
    const download = { preventDefault: vi.fn() }
    session.emit('will-download', download)
    expect(download.preventDefault).toHaveBeenCalledOnce()
    expect(session.permissionCheckHandler?.(undefined, 'clipboard-read')).toBe(false)
    for (const permission of ['camera', 'microphone', 'geolocation', 'clipboard-read', 'clipboard-write']) {
      const callback = vi.fn()
      session.permissionRequestHandler?.(undefined, permission, callback)
      expect(callback).toHaveBeenCalledWith(false)
    }

    const allowed = { preventDefault: vi.fn() }
    const denied = { preventDefault: vi.fn() }
    contents.emit('will-navigate', allowed, 'https://allowed.test/')
    contents.emit('will-redirect', denied, 'http://127.0.0.1/')
    expect(allowed.preventDefault).not.toHaveBeenCalled()
    expect(denied.preventDefault).toHaveBeenCalledOnce()
    registration.dispose()
    expect(session.listeners.get('will-download')?.size ?? 0).toBe(0)
    expect(contents.listeners.get('will-navigate')?.size ?? 0).toBe(0)
    expect(contents.listeners.get('will-redirect')?.size ?? 0).toBe(0)
    expect(session.permissionCheckHandler?.()).toBe(true)
    const restored = vi.fn()
    session.permissionRequestHandler?.(undefined, 'camera', restored)
    expect(restored).toHaveBeenCalledWith(true)
  })

  it('does not let stale generation cleanup remove newer handlers', () => {
    const contents = new FakePolicyContents()
    const session = new FakePolicySession()
    const owner = ownerFor(contents, session)
    const first = installBrowserSecurityHandlers({ owner, generation: 1, allowsNavigation: () => false })
    const firstCheck = session.permissionCheckHandler
    const second = installBrowserSecurityHandlers({ owner, generation: 2, allowsNavigation: () => true })
    const secondCheck = session.permissionCheckHandler

    first.dispose()
    expect(session.permissionCheckHandler).toBe(secondCheck)
    expect(session.permissionCheckHandler).toBe(firstCheck)
    expect(contents.listeners.get('will-navigate')?.size).toBe(1)
    second.dispose()
    expect(session.permissionCheckHandler?.()).toBe(true)
    expect(contents.listeners.get('will-navigate')?.size ?? 0).toBe(0)
  })

  it('rejects privileged navigation even when the generation predicate is permissive', () => {
    const contents = new FakePolicyContents()
    const session = new FakePolicySession()
    const owner = ownerFor(contents, session)
    const registration = installBrowserSecurityHandlers({ owner, generation: 1, allowsNavigation: () => true })
    const privileged = { preventDefault: vi.fn() }

    contents.emit('will-navigate', privileged, 'file:///tmp/untrusted')
    expect(privileged.preventDefault).toHaveBeenCalledOnce()
    registration.dispose()
  })

  it('layers Agent guards over preexisting human handlers without replacing or nulling them', () => {
    const contents = new FakePolicyContents()
    const session = new FakePolicySession()
    const humanWindowOpen = vi.fn(() => ({ action: 'allow' as const }))
    const humanPermissionCheck = vi.fn((_contents: unknown, permission: string) => permission === 'clipboard-read')
    const humanPermissionRequest = vi.fn((
      _contents: unknown,
      permission: string,
      callback: (allowed: boolean) => void,
    ) => { callback(permission === 'clipboard-read') })
    const humanDownload = vi.fn()
    session.on('will-download', humanDownload)
    const owner = createBrowserSecurityHandlerOwner({
      contents,
      session,
      baseWindowOpenHandler: humanWindowOpen,
      basePermissionCheckHandler: humanPermissionCheck,
      basePermissionRequestHandler: humanPermissionRequest,
    })
    const installedWindowDispatcher = contents.windowOpenHandler
    const installedCheckDispatcher = session.permissionCheckHandler
    const installedRequestDispatcher = session.permissionRequestHandler

    expect(contents.windowOpenHandler?.({ url: 'https://human.test/' })).toEqual({ action: 'allow' })
    expect(session.permissionCheckHandler?.(undefined, 'clipboard-read')).toBe(true)
    const before = vi.fn()
    session.permissionRequestHandler?.(undefined, 'clipboard-read', before)
    expect(before).toHaveBeenCalledWith(true)

    const registration = installBrowserSecurityHandlers({
      owner,
      generation: 7,
      allowsNavigation: () => false,
    })
    expect(contents.windowOpenHandler?.({ url: 'https://human.test/' })).toEqual({ action: 'deny' })
    expect(session.permissionCheckHandler?.(undefined, 'clipboard-read')).toBe(false)
    const during = vi.fn()
    session.permissionRequestHandler?.(undefined, 'clipboard-read', during)
    expect(during).toHaveBeenCalledWith(false)
    const download = { preventDefault: vi.fn() }
    session.emit('will-download', download)
    expect(download.preventDefault).toHaveBeenCalledOnce()
    expect(humanDownload).toHaveBeenCalledOnce()

    registration.dispose()
    expect(contents.windowOpenHandler).toBe(installedWindowDispatcher)
    expect(session.permissionCheckHandler).toBe(installedCheckDispatcher)
    expect(session.permissionRequestHandler).toBe(installedRequestDispatcher)
    expect(contents.windowOpenSetterCalls).toBe(1)
    expect(session.permissionCheckSetterCalls).toBe(1)
    expect(session.permissionRequestSetterCalls).toBe(1)
    expect(contents.windowOpenHandler?.({ url: 'https://human.test/' })).toEqual({ action: 'allow' })
    expect(session.permissionCheckHandler?.(undefined, 'clipboard-read')).toBe(true)
    const after = vi.fn()
    session.permissionRequestHandler?.(undefined, 'clipboard-read', after)
    expect(after).toHaveBeenCalledWith(true)
    const laterDownload = { preventDefault: vi.fn() }
    session.emit('will-download', laterDownload)
    expect(laterDownload.preventDefault).not.toHaveBeenCalled()
    expect(humanDownload).toHaveBeenCalledTimes(2)
  })
})
