// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnNavigator } from '../src/client/chat/TurnNavigator.tsx'
import type { TurnRailItem } from '../src/client/chat/turn-rail-items.ts'
import type { ChatViewSlotProps } from '../src/client/contract/slots.ts'

function loadedItem(turn: number, prompt = `p${String(turn)}`, response = `r${String(turn)}`): TurnRailItem {
  return { turn, prompt, response, anchor: { kind: 'loaded', key: `anchor-${String(turn)}` } }
}

function unloadedItem(turn: number, seq: number): TurnRailItem {
  return { turn, prompt: '', response: '', anchor: { kind: 'unloaded', seq: SessionSeq(seq) } }
}

function t(key: string, params?: Record<string, unknown>): string {
  const value = {
    'chat.turnNavigation.label': '轮次导航',
    'chat.turnNavigation.jump': '跳转到第 {turn} 轮',
    'chat.turnNavigation.jumpLoad': '加载并跳转到第 {turn} 轮',
    'chat.turnNavigation.turn': '第 {turn} 轮',
  }[key] ?? key
  return params === undefined ? value : value.replaceAll('{turn}', String(params['turn']))
}

function renderNavigator(items: readonly TurnRailItem[], activeTurn: number | null = null) {
  const onNavigate = vi.fn()
  const view = render(
    <TurnNavigator
      items={items}
      activeTurn={activeTurn}
      busyTurn={null}
      onNavigate={onNavigate}
      t={t as ChatViewSlotProps['t']}
    />,
  )
  return { onNavigate, view }
}

afterEach(cleanup)

describe('TurnNavigator', () => {
  it('renders exactly one mark per turn across loaded and unloaded entries', () => {
    const items = [loadedItem(1), unloadedItem(2, 8), loadedItem(3), unloadedItem(4, 16)]
    renderNavigator(items, 2)

    const marks = screen.getAllByRole('button', { name: /(?:跳转到|加载并跳转到)第/u })
    expect(marks).toHaveLength(4)
    expect(screen.getByRole('button', { name: '跳转到第 1 轮' })).toBeDefined()
    expect(screen.getByRole('button', { name: '加载并跳转到第 2 轮' })).toBeDefined()
    expect(screen.getByRole('button', { name: '跳转到第 3 轮' })).toBeDefined()
    expect(screen.getByRole('button', { name: '加载并跳转到第 4 轮' })).toBeDefined()
    // One mark per turn: the active turn keeps its single jump control.
    expect(screen.getByRole('button', { name: '加载并跳转到第 2 轮' }).getAttribute('aria-current')).toBe('true')
  })

  it('marks the active turn and exposes busy turns through aria-busy', () => {
    const items = [loadedItem(1), unloadedItem(2, 8)]
    renderNavigator(items, 1)

    expect(screen.getByRole('button', { name: '跳转到第 1 轮' }).getAttribute('aria-current')).toBe('true')
  })

  it('forwards an unloaded mark with its seq so the owner can loadThrough before landing', () => {
    const items = [loadedItem(1), unloadedItem(2, 8), loadedItem(3)]
    const { onNavigate } = renderNavigator(items)

    fireEvent.click(screen.getByRole('button', { name: '加载并跳转到第 2 轮' }))
    expect(onNavigate).toHaveBeenCalledWith(items[1])
    expect(items[1]?.anchor).toEqual({ kind: 'unloaded', seq: 8 })
  })

  it('forwards a loaded mark with its anchor key for direct scrolling', () => {
    const items = [loadedItem(1), loadedItem(2)]
    const { onNavigate } = renderNavigator(items)

    fireEvent.click(screen.getByRole('button', { name: '跳转到第 2 轮' }))
    expect(onNavigate).toHaveBeenCalledWith(items[1])
    expect(items[1]?.anchor).toEqual({ kind: 'loaded', key: 'anchor-2' })
  })

  it('renders nothing below two turns', () => {
    const { view } = renderNavigator([loadedItem(1)])
    expect(view.container.querySelector('nav')).toBeNull()
  })
})
