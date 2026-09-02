// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { PendingWait } from '@deepseek-ai/dsh-client-runtime/client'
import { RpcId, type RpcReceipt } from '@deepseek-ai/dsh-client-connection/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ApprovalComposerProps } from '../src/client/contract/slots.ts'
import { ApprovalPanel } from '../src/client/skeleton/ApprovalPanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const SID = 'approval-session' as SessionId
const t = makeTranslate(zh, commonZh) as ApprovalComposerProps['t']

function approvalWait(
  respond = vi.fn(() => Promise.resolve<RpcReceipt>({ accepted: true })),
) {
  const carrier = new PendingWait('approval', RpcId('approval-rpc'), SID, {
    approvalId: 'approval-id' as never,
    toolName: 'bash',
    reason: '需要执行受保护的操作',
  }, respond)
  return { carrier, respond }
}

function renderApproval(options: {
  runSessionCommand?: (line: string) => Promise<boolean>
  respond?: ReturnType<typeof vi.fn<(message: never) => Promise<RpcReceipt>>>
} = {}) {
  const respond = options.respond ?? vi.fn(() => Promise.resolve<RpcReceipt>({ accepted: true }))
  const { carrier } = approvalWait(respond as never)
  const runSessionCommand = options.runSessionCommand ?? vi.fn(() => Promise.resolve(true))
  const props = {
    matched: carrier,
    interactions: [carrier],
    session: undefined,
    sessionId: SID,
    useSession: ((selector: (snapshot: ConversationSnapshot) => unknown) =>
      selector({} as ConversationSnapshot)) as SnapshotSelectorHook<ConversationSnapshot>,
    useSessions: (() => { throw new Error('unused') }) as never,
    useWorkspaces: (() => { throw new Error('unused') }) as never,
    useProjection: (() => undefined) as never,
    useInput: (() => { throw new Error('unused') }) as never,
    inputActions: {} as never,
    runSessionCommand,
    t,
  } satisfies ApprovalComposerProps
  return { ...render(<ApprovalPanel {...props} />), respond, runSessionCommand }
}

function expectedAnswer(outcome: 'allowed-once' | 'rejected') {
  return {
    type: 'client-response',
    rpcId: RpcId('approval-rpc'),
    result: {
      ok: true,
      value: { sessionId: SID, approvalId: 'approval-id', outcome },
    },
  }
}

describe('ApprovalPanel session-scoped Full access', () => {
  it('keeps Allow once one-shot and never changes the Session permission preset', async () => {
    const { respond, runSessionCommand } = renderApproval()

    fireEvent.click(screen.getByRole('button', { name: '允许一次' }))

    await waitFor(() => { expect(respond).toHaveBeenCalledWith(expectedAnswer('allowed-once')) })
    expect(runSessionCommand).not.toHaveBeenCalled()
  })

  it('keeps Reject one-shot and never changes the Session permission preset', async () => {
    const { respond, runSessionCommand } = renderApproval()

    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))

    await waitFor(() => { expect(respond).toHaveBeenCalledWith(expectedAnswer('rejected')) })
    expect(runSessionCommand).not.toHaveBeenCalled()
  })

  it('requires the shared Full access acknowledgement, then changes permission before answering', async () => {
    const order: string[] = []
    const runSessionCommand = vi.fn(async () => { order.push('permission'); return true })
    const respond = vi.fn(async () => { order.push('answer'); return { accepted: true } satisfies RpcReceipt })
    renderApproval({ runSessionCommand, respond: respond as never })

    fireEvent.click(screen.getByRole('button', { name: '本会话不再询问' }))
    expect(runSessionCommand).not.toHaveBeenCalled()
    expect(respond).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '确认启用 Full access？' })).toBeTruthy()
    const enable = screen.getByRole('button', { name: '启用 Full access' }) as HTMLButtonElement
    expect(enable.disabled).toBe(true)

    fireEvent.click(screen.getByRole('checkbox', { name: '我已了解风险，并愿意继续' }))
    fireEvent.click(enable)

    await waitFor(() => { expect(respond).toHaveBeenCalledWith(expectedAnswer('allowed-once')) })
    expect(runSessionCommand).toHaveBeenCalledExactlyOnceWith('/permission danger-full-access')
    expect(order).toEqual(['permission', 'answer'])
  })

  it('disables all three card actions while the permission command is pending and cannot send it twice', async () => {
    const commandResult = Promise.withResolvers<boolean>()
    const runSessionCommand = vi.fn(() => commandResult.promise)
    const { respond } = renderApproval({ runSessionCommand })
    fireEvent.click(screen.getByRole('button', { name: '本会话不再询问' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '启用 Full access' }))

    const reject = screen.getByRole('button', { name: '拒绝' }) as HTMLButtonElement
    const once = screen.getByRole('button', { name: '允许一次' }) as HTMLButtonElement
    const session = screen.getByRole('button', { name: '本会话不再询问' }) as HTMLButtonElement
    expect([reject.disabled, once.disabled, session.disabled]).toEqual([true, true, true])
    fireEvent.click(session)
    expect(runSessionCommand).toHaveBeenCalledOnce()
    expect(respond).not.toHaveBeenCalled()

    commandResult.resolve(false)
    await waitFor(() => { expect(session.disabled).toBe(false) })
  })

  it.each([
    ['an unmatched command', vi.fn(() => Promise.resolve(false))],
    ['a command transport failure', vi.fn(() => Promise.reject(new Error('offline secret detail')))],
  ])('keeps the approval retryable after %s', async (_label, runSessionCommand) => {
    const { respond } = renderApproval({ runSessionCommand })
    fireEvent.click(screen.getByRole('button', { name: '本会话不再询问' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '启用 Full access' }))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('无法启用 Full access，请重试')
    })
    expect(screen.queryByText('offline secret detail')).toBeNull()
    expect(respond).not.toHaveBeenCalled()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '本会话不再询问' }).disabled).toBe(false)
  })

  it('retries only the current approval when Full access succeeded but answering failed', async () => {
    const runSessionCommand = vi.fn(() => Promise.resolve(true))
    const respond = vi.fn()
      .mockResolvedValueOnce({ accepted: false, reason: 'bad-response' } satisfies RpcReceipt)
      .mockResolvedValueOnce({ accepted: true } satisfies RpcReceipt)
    renderApproval({ runSessionCommand, respond: respond as never })
    fireEvent.click(screen.getByRole('button', { name: '本会话不再询问' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '启用 Full access' }))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Full access 已启用，请重试当前审批')
    })
    expect(screen.queryByText('bad-response')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重试当前审批' }))

    await act(async () => {})
    expect(runSessionCommand).toHaveBeenCalledOnce()
    expect(respond).toHaveBeenCalledTimes(2)
    expect(respond).toHaveBeenLastCalledWith(expectedAnswer('allowed-once'))
  })
})
