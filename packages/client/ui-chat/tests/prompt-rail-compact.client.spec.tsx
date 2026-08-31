// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { PromptRail } from '../src/client/chat/PromptRail.tsx'
import { zh } from '../src/client/locale.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PromptRail compact presentation', () => {
  it('keeps its full label accessible without painting it over the conversation', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(max-width: 860px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })))

    render(
      <PromptRail
        anchors={[
          { seq: 1, turn: 1, time: 1_000, preview: 'first', kind: 'turn-opening' },
          { seq: 2, turn: 2, time: 2_000, preview: 'second', kind: 'turn-opening' },
        ]}
        activeSeq={2}
        onActivate={vi.fn()}
        t={makeTranslate(zh, commonZh)}
      />,
    )

    const trigger = screen.getByRole('button', { name: '发言导航（2 / 2）' })
    expect(trigger.textContent).toBe('2 / 2')
  })
})
