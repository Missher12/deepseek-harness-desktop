// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeaderButton, type HeaderButtonProps } from '../src/client/HeaderButton.tsx'
import { WorkbenchPanel, type WorkbenchPanelProps } from '../src/client/WorkbenchPanel.tsx'
import { WorkbenchController } from '../src/client/preferences.ts'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'dshDesktop')
})

const sessionId = 'session-a' as never
const labels = {
  open: '打开工作台', close: '关闭工作台', terminal: '终端', browser: '浏览器',
  files: '文件', review: '审阅',
} as const
const t = (key: keyof typeof labels) => labels[key]

function setup() {
  let snapshot: { open: boolean; mode: 'terminal' | 'browser' | 'files' | 'review'; width: number } = {
    open: false, mode: 'terminal', width: 720,
  }
  const listeners = new Set<() => void>()
  const publish = (next: typeof snapshot) => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const layout = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    openUtility: vi.fn((mode?: typeof snapshot.mode) => {
      publish({ ...snapshot, open: true, mode: mode ?? snapshot.mode })
    }),
    closeUtility: vi.fn(() => { publish({ ...snapshot, open: false }) }),
    toggleUtility: vi.fn((mode?: typeof snapshot.mode) => {
      publish(mode !== undefined && mode !== snapshot.mode
        ? { ...snapshot, open: true, mode }
        : { ...snapshot, open: !snapshot.open })
    }),
    setUtilityWidth: vi.fn((width: number) => { publish({ ...snapshot, width }) }),
  }
  const controller = new WorkbenchController(layout as never)
  const common = {
    sessionId,
    useWorkbench: <T,>(select: (state: ReturnType<typeof controller.getSnapshot>) => T) => select(controller.getSnapshot()),
    toggle: (id: typeof sessionId) => { controller.toggle(id) },
    open: (id: typeof sessionId, mode: 'browser') => { controller.open(id, mode) },
    close: () => { controller.close() },
    selectMode: (mode: Parameters<typeof controller.selectMode>[0]) => { controller.selectMode(mode) },
    t,
  }
  return { controller, layout, common }
}

describe('desktop workbench shell', () => {
  it('delegates width changes to the layout store', () => {
    const { controller, layout } = setup()

    controller.setWidth(1_400)

    expect(controller.getSnapshot().width).toBe(1_400)
    expect(layout.setUtilityWidth).toHaveBeenLastCalledWith(1_400)
  })

  it('does not overwrite the layout store width from the retired workbench preference', () => {
    const snapshot = { open: false, mode: 'terminal' as const, width: 880 }
    const layout = {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      openUtility: vi.fn(), closeUtility: vi.fn(), toggleUtility: vi.fn(), setUtilityWidth: vi.fn(),
    }
    const controller = new WorkbenchController(layout as never)

    controller.open(sessionId, 'browser')

    expect(layout.setUtilityWidth).not.toHaveBeenCalled()
  })

  it('reads open, mode, and width from the observable layout source', () => {
    const snapshot = { open: true, mode: 'browser' as const, width: 880 }
    const layout = {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      openUtility: vi.fn(), closeUtility: vi.fn(), toggleUtility: vi.fn(), setUtilityWidth: vi.fn(),
    }
    const controller = new WorkbenchController(layout as never)

    expect(controller.getSnapshot()).toEqual(snapshot)
  })

  it('derives the header expanded state from layout, not a second session flag', () => {
    const { common } = setup()
    const view = render(<HeaderButton {...{
      ...common,
      useWorkbench: (select: (state: { open: boolean; mode: 'browser'; width: number }) => unknown) =>
        select({ open: true, mode: 'browser', width: 880 }),
    } as unknown as HeaderButtonProps} />)

    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true')
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

  it('opens the Browser Dock for the current session when Electron requests an Agent host', () => {
    let requestDock: (() => void) | undefined
    const visibleSessionChanged = vi.fn(async () => {})
    Object.defineProperty(window, 'dshDesktop', {
      configurable: true,
      value: {
        onWorkbenchBrowserDockRequest(listener: () => void) {
          requestDock = listener
          return () => { requestDock = undefined }
        },
        notifyVisibleSessionChanged: visibleSessionChanged,
      },
    })
    const { controller, layout, common } = setup()
    render(<HeaderButton {...common as unknown as HeaderButtonProps} />)

    act(() => { requestDock?.() })

    expect(controller.getSnapshot()).toMatchObject({ open: true, mode: 'browser' })
    expect(layout.openUtility).toHaveBeenLastCalledWith('browser')
    expect(visibleSessionChanged).toHaveBeenCalledOnce()
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

  it('leaves arrow keys inside Browser inputs instead of switching workbench tabs', () => {
    const { controller, layout, common } = setup()
    controller.open(sessionId, 'browser')
    layout.openUtility.mockClear()
    const view = render(<WorkbenchPanel {...common as unknown as WorkbenchPanelProps} mode="browser" />)
    const address = view.container.querySelector('input')
    if (address === null) throw new Error('Browser address input missing')

    fireEvent.keyDown(address, { key: 'ArrowRight' })

    expect(layout.openUtility).not.toHaveBeenCalled()
  })

  it('uses one roving tab stop and labels the active tab panel', () => {
    const { common } = setup()
    const view = render(<WorkbenchPanel {...common as unknown as WorkbenchPanelProps} mode="browser" />)
    const tabs = screen.getAllByRole('tab')
    const active = screen.getByRole('tab', { name: '浏览器' })
    const panel = screen.getByRole('tabpanel')

    expect(tabs.map(tab => tab.tabIndex)).toEqual([-1, 0, -1, -1])
    expect(active.id).not.toBe('')
    expect(active.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(active.id)

    fireEvent.keyDown(active, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(view.getByRole('tab', { name: '文件' }))
  })

  it('opens and reopens without overwriting the layout-owned width', () => {
    const { controller, layout } = setup()
    controller.open(sessionId)
    expect(layout.setUtilityWidth).not.toHaveBeenCalled()

    controller.close()
    controller.open(sessionId, 'browser')

    expect(layout.setUtilityWidth).not.toHaveBeenCalled()
    expect(layout.openUtility).toHaveBeenLastCalledWith('browser')
  })
})
