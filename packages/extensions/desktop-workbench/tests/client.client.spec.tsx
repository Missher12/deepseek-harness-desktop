// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeaderButton } from '../src/client/HeaderButton.tsx'
import { WorkbenchPanel } from '../src/client/WorkbenchPanel.tsx'
import { WorkbenchController, loadWidth } from '../src/client/preferences.ts'

afterEach(cleanup)

const sessionId = 'session-a' as never
const labels = {
  open: '打开工作台', close: '关闭工作台', terminal: '终端', browser: '浏览器',
  files: '文件', 'side-chat': '侧边聊天', review: '审阅',
} as const
const t = (key: keyof typeof labels) => labels[key]

function setup() {
  const layout = {
    openUtility: vi.fn(), closeUtility: vi.fn(), toggleUtility: vi.fn(), setUtilityWidth: vi.fn(),
  }
  const controller = new WorkbenchController(layout, { getItem: () => null, setItem: vi.fn() })
  const common = {
    sessionId,
    useWorkbench: <T,>(select: (state: ReturnType<typeof controller.getSnapshot>) => T) => select(controller.getSnapshot()),
    toggle: (id: typeof sessionId) => { controller.toggle(id) },
    close: () => { controller.close() },
    selectMode: (mode: Parameters<typeof controller.selectMode>[0]) => { controller.selectMode(mode) },
    t,
  }
  return { controller, layout, common }
}

describe('desktop workbench shell', () => {
  it('clamps the persisted width', () => {
    expect(loadWidth({ getItem: () => '9999' })).toBe(720)
    expect(loadWidth({ getItem: () => '100' })).toBe(320)
    expect(loadWidth({ getItem: () => 'nope' })).toBe(420)
  })

  it('opens from the compact header button and exposes five Harness-style tabs', () => {
    const { controller, common } = setup()
    const view = render(<>
      <HeaderButton {...common as never} />
      <WorkbenchPanel {...common as never} mode="terminal" />
    </>)
    const button = screen.getByRole('button', { name: '打开工作台' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    view.rerender(<>
      <HeaderButton {...common as never} />
      <WorkbenchPanel {...common as never} mode={controller.getSnapshot().mode} />
    </>)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['终端', '浏览器', '文件', '侧边聊天', '审阅'])
  })

  it('switches modes without closing and closes on Escape', () => {
    const { controller, layout, common } = setup()
    controller.open(sessionId, 'terminal')
    const view = render(<WorkbenchPanel {...common as never} mode="terminal" />)
    fireEvent.click(screen.getByRole('tab', { name: '文件' }))
    expect(layout.openUtility).toHaveBeenLastCalledWith('files')
    fireEvent.keyDown(view.container.firstElementChild!, { key: 'Escape' })
    expect(layout.closeUtility).toHaveBeenCalledOnce()
  })
})
