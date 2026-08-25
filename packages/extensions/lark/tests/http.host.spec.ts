import { describe, expect, test, vi } from 'vitest'
import { dispatchLarkControl, MAX_CONTROL_BODY_BYTES } from '../src/http.ts'

function port() {
  return {
    status: vi.fn(async () => ({
      enabled: false, connected: false, queuePaused: true,
      credentials: { appId: true, appSecret: true }, pairing: 'unpaired', binding: null, queueDepth: 2,
    })),
    enable: vi.fn(async () => {}), disable: vi.fn(async () => {}), resume: vi.fn(async () => {}),
    clear: vi.fn(async () => {}), pair: vi.fn(async () => {}), repair: vi.fn(async () => {}),
    cleanup: vi.fn(async () => 0), test: vi.fn(async () => ({ ok: true })),
    setCredentials: vi.fn(async () => {}),
  }
}

const request = (body?: unknown) => ({
  method: body === undefined ? 'GET' : 'POST',
  host: '127.0.0.1:43821', origin: body === undefined ? undefined : 'http://127.0.0.1:43821',
  capability: 'capability', body: body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body)),
})

describe('same-origin Lark control capability', () => {
  test('rejects foreign origin/capability and bounded-body violations', async () => {
    const p = port()
    await expect(dispatchLarkControl({ ...request(), capability: 'wrong' }, p, 'capability', 43821))
      .resolves.toMatchObject({ status: 403 })
    await expect(dispatchLarkControl({ ...request({ action: 'enable' }), origin: 'https://evil.test' }, p, 'capability', 43821))
      .resolves.toMatchObject({ status: 403 })
    await expect(dispatchLarkControl({ ...request({}), body: new Uint8Array(MAX_CONTROL_BODY_BYTES + 1) }, p, 'capability', 43821))
      .resolves.toMatchObject({ status: 413 })
  })

  test('returns redacted status without credential values or App ID', async () => {
    const p = port()
    const response = await dispatchLarkControl(request(), p, 'capability', 43821)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ credentials: { appId: true, appSecret: true } })
    expect(JSON.stringify(response.body)).not.toContain('cli_')
    expect(JSON.stringify(response.body)).not.toContain('secret')
  })

  test('keeps credentials write-only and requires confirmation for destructive actions', async () => {
    const p = port()
    const credentialResponse = await dispatchLarkControl(request({
      action: 'set-credentials', appId: 'cli_value', appSecret: 'secret-value',
    }), p, 'capability', 43821)
    expect(p.setCredentials).toHaveBeenCalledWith('cli_value', 'secret-value')
    expect(JSON.stringify(credentialResponse.body)).not.toContain('cli_value')
    expect(JSON.stringify(credentialResponse.body)).not.toContain('secret-value')
    await expect(dispatchLarkControl(request({ action: 'clear' }), p, 'capability', 43821))
      .resolves.toMatchObject({ status: 400 })
    await dispatchLarkControl(request({ action: 'clear', confirm: true }), p, 'capability', 43821)
    expect(p.clear).toHaveBeenCalledOnce()
  })

  test('routes enable, disable, resume, pair, repair, test, and cleanup narrowly', async () => {
    const p = port()
    for (const body of [
      { action: 'enable' }, { action: 'disable' }, { action: 'resume' },
      { action: 'pair', code: 'ABCD-1234' }, { action: 'repair', confirm: true },
      { action: 'test' }, { action: 'cleanup' },
    ]) await dispatchLarkControl(request(body), p, 'capability', 43821)
    expect(p.enable).toHaveBeenCalledOnce()
    expect(p.disable).toHaveBeenCalledOnce()
    expect(p.resume).toHaveBeenCalledOnce()
    expect(p.pair).toHaveBeenCalledWith('ABCD-1234')
    expect(p.repair).toHaveBeenCalledOnce()
    expect(p.test).toHaveBeenCalledOnce()
    expect(p.cleanup).toHaveBeenCalledOnce()
  })
})
