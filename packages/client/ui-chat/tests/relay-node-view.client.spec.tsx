// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RelayNodeView } from '../src/client/chat/RelayNodeView.tsx'
import { en, zh } from '../src/client/locale.ts'

afterEach(cleanup)

function sessions(byId: SessionListState['byId'] = {}): SessionListState {
  return {
    ids: [], byId, current: undefined, phase: 'ready', subagentsByParent: {},
    jobsBySession: {}, currentAddress: undefined,
  }
}

function hook(snapshot: SessionListState) {
  return function select<S>(selector: (state: SessionListState) => S): S { return selector(snapshot) }
}

describe('RelayNodeView', () => {
  it('uses the sender session title and localized wake attribution', () => {
    const senderId = 'sender-1' as SessionId
    const sender: SessionSummary = {
      id: senderId, displayTitle: '发送会话', title: '发布助手', running: false,
      blank: false, updatedAt: 1,
    }
    render(
      <RelayNodeView
        content={[{ type: 'text', text: '已完成发布' }] as never}
        source={{
          kind: 'plugin', plugin: 'dsh-session-messenger', form: 'relay',
          senderSessionId: 'sender-1', bodyBlockIndex: 0, mode: 'followup',
        }}
        useSessions={hook(sessions({ [senderId]: sender }))}
        t={makeTranslate(zh, commonZh)}
      />,
    )

    expect(screen.getByText('来自 发布助手')).toBeTruthy()
    expect(screen.getByText('已唤醒')).toBeTruthy()
    expect(screen.getByText('已完成发布')).toBeTruthy()
  })

  it('localizes an unnamed sender instead of exposing a missing locale key', () => {
    render(
      <RelayNodeView
        content={[]}
        source={{ kind: 'plugin', plugin: 'dsh-session-messenger', form: 'relay' }}
        useSessions={hook(sessions())}
        t={makeTranslate(en, commonEn)}
      />,
    )

    expect(screen.getByText('From unknown session')).toBeTruthy()
  })
})
