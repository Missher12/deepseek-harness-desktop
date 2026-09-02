// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { UtilityMode } from '@deepseek-ai/dsh-client-ui-layout/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeaderButton, type HeaderButtonProps } from '../src/client/HeaderButton.tsx'
import { WorkbenchPanel, type WorkbenchPanelProps } from '../src/client/WorkbenchPanel.tsx'
import { WorkbenchController, loadWidth } from '../src/client/preferences.ts'

afterEach(cleanup)

const sessionId = 'session-a' as never
const WORKBENCH_MODE_FIXTURE: readonly UtilityMode[] = ['review', 'terminal', 'browser', 'files']
const labels = {
  open: '打开工作台', close: '关闭工作台', terminal: '终端', browser: '浏览器',
  files: '文件', review: '审阅',
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
  it('keeps one reusable fixture for every existing workbench mode', () => {
    const { controller, layout } = setup()

    for (const mode of WORKBENCH_MODE_FIXTURE) controller.open(sessionId, mode)

    for (const [index, mode] of WORKBENCH_MODE_FIXTURE.entries()) {
      expect(layout.openUtility).toHaveBeenNthCalledWith(index + 1, mode)
    }
  })

  it('defers persisted width until the first open after the layout root mounts', () => {
    const layout = new LayoutController()
    const controller = new WorkbenchController(layout, {
      getItem: () => '512',
      setItem: vi.fn(),
    })
    const panels = {
      setSidebar: vi.fn(), setDetails: vi.fn(), toggleSidebar: vi.fn(),
      openDetails: vi.fn(), closeDetails: vi.fn(), openUtility: vi.fn(),
      closeUtility: vi.fn(), toggleUtility: vi.fn(), setUtilityWidth: vi.fn(),
    }
    layout.attachPanels(panels as never)

    controller.open(sessionId)

    expect(panels.setUtilityWidth).toHaveBeenCalledWith(512)
    expect(panels.openUtility).toHaveBeenCalledWith('terminal')
  })

  it('clamps the persisted width', () => {
    expect(loadWidth({ getItem: () => null })).toBe(420)
    expect(loadWidth({ getItem: () => '9999' })).toBe(720)
    expect(loadWidth({ getItem: () => '100' })).toBe(320)
    expect(loadWidth({ getItem: () => 'nope' })).toBe(420)
  })

  it('opens from the compact header button without a duplicate side-chat surface', () => {
    const { controller, common } = setup()
    const headerProps = common as unknown as HeaderButtonProps
    const panelProps = common as unknown as WorkbenchPanelProps
    const view = render(<>
      <HeaderButton {...headerProps} />
      <WorkbenchPanel {...panelProps} mode="terminal" />
    </>)
    const button = screen.getByRole('button', { name: '打开工作台' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    view.rerender(<>
      <HeaderButton {...headerProps} />
      <WorkbenchPanel {...panelProps} mode={controller.getSnapshot().mode} />
    </>)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('[data-desktop-workbench-panel]')).not.toBeNull()
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['终端', '浏览器', '文件', '审阅'])
    expect(screen.queryByRole('tab', { name: '侧边聊天' })).toBeNull()
  })

  it('switches modes without closing and closes on Escape', () => {
    const { controller, layout, common } = setup()
    controller.open(sessionId, 'terminal')
    layout.setUtilityWidth.mockClear()
    const panelProps = common as unknown as WorkbenchPanelProps
    const view = render(<WorkbenchPanel {...panelProps} mode="terminal" />)
    fireEvent.click(screen.getByRole('tab', { name: '文件' }))
    expect(layout.setUtilityWidth).not.toHaveBeenCalled()
    expect(layout.openUtility).toHaveBeenLastCalledWith('files')
    fireEvent.keyDown(view.container.firstElementChild!, { key: 'Escape' })
    expect(layout.closeUtility).toHaveBeenCalledOnce()
  })

  it('restores the saved width once without overwriting later drag widths on reopen', () => {
    const { controller, layout } = setup()
    controller.open(sessionId)
    expect(layout.setUtilityWidth).toHaveBeenCalledOnce()
    layout.setUtilityWidth.mockClear()

    controller.close()
    controller.open(sessionId, 'browser')

    expect(layout.setUtilityWidth).not.toHaveBeenCalled()
    expect(layout.openUtility).toHaveBeenLastCalledWith('browser')
  })
})
