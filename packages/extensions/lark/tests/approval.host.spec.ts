import { describe, expect, test, vi } from 'vitest'
import { ApprovalBridge } from '../src/approval.ts'

describe('ApiProxy approval bridge', () => {
  test.each([
    ['allow-once', 'allowed-once'],
    ['deny', 'rejected'],
  ] as const)('maps %s to the existing pending ApiProxy request', async (action, outcome) => {
    const respond = vi.fn(async () => ({ accepted: true as const }))
    const bridge = new ApprovalBridge({ respond })
    await expect(bridge.answer({
      rpcId: 'rpc-1', sessionId: 'session-1', approvalId: 'approval-1', action,
    })).resolves.toEqual({ accepted: true })
    expect(respond).toHaveBeenCalledWith({
      type: 'client-response', rpcId: 'rpc-1',
      result: { ok: true, value: { sessionId: 'session-1', approvalId: 'approval-1', outcome } },
    })
  })

  test('treats desktop/Feishu races as already settled and never broadens permission', async () => {
    const respond = vi.fn(async () => ({ accepted: false as const, reason: 'not-pending' as const }))
    const bridge = new ApprovalBridge({ respond })
    await expect(bridge.answer({
      rpcId: 'rpc-1', sessionId: 'session-1', approvalId: 'approval-1', action: 'allow-once',
    })).resolves.toEqual({ accepted: false, reason: 'not-pending' })
    expect(respond).toHaveBeenCalledOnce()
  })
})
