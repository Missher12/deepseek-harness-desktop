import { describe, expect, it, vi } from 'vitest'
import {
  AgentBrowserUrlPolicy,
  classifyBrowserTarget,
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
  windowOpenHandler: ((details: { url: string }) => { action: 'deny' }) | undefined

  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void {
    this.windowOpenHandler = handler
  }
}

class FakePolicySession extends FakeEventTarget {
  permissionCheckHandler: ((...args: unknown[]) => boolean) | null = null
  permissionRequestHandler: ((contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) | null = null

  setPermissionCheckHandler(handler: ((...args: unknown[]) => boolean) | null): void {
    this.permissionCheckHandler = handler
  }

  setPermissionRequestHandler(
    handler: ((contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) | null,
  ): void {
    this.permissionRequestHandler = handler
  }
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
    const registration = installBrowserSecurityHandlers({
      contents,
      session,
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
    expect(session.permissionCheckHandler).toBeNull()
    expect(session.permissionRequestHandler).toBeNull()
  })

  it('does not let stale generation cleanup remove newer handlers', () => {
    const contents = new FakePolicyContents()
    const session = new FakePolicySession()
    const first = installBrowserSecurityHandlers({ contents, session, allowsNavigation: () => false })
    const firstCheck = session.permissionCheckHandler
    const second = installBrowserSecurityHandlers({ contents, session, allowsNavigation: () => true })
    const secondCheck = session.permissionCheckHandler

    first.dispose()
    expect(session.permissionCheckHandler).toBe(secondCheck)
    expect(session.permissionCheckHandler).not.toBe(firstCheck)
    expect(contents.listeners.get('will-navigate')?.size).toBe(1)
    second.dispose()
    expect(session.permissionCheckHandler).toBeNull()
    expect(contents.listeners.get('will-navigate')?.size ?? 0).toBe(0)
  })

  it('rejects privileged navigation even when the generation predicate is permissive', () => {
    const contents = new FakePolicyContents()
    const session = new FakePolicySession()
    const registration = installBrowserSecurityHandlers({ contents, session, allowsNavigation: () => true })
    const privileged = { preventDefault: vi.fn() }

    contents.emit('will-navigate', privileged, 'file:///tmp/untrusted')
    expect(privileged.preventDefault).toHaveBeenCalledOnce()
    registration.dispose()
  })
})
