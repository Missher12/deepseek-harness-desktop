// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { UtilityMode } from '@deepseek-ai/dsh-client-ui-layout/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserSkillMode } from '../src/client/BrowserSkillMode.tsx'
import { HeaderButton, type HeaderButtonProps } from '../src/client/HeaderButton.tsx'
import { workbenchModeDefinitions } from '../src/client/modes.ts'
import { WorkbenchPanel, type WorkbenchPanelProps } from '../src/client/WorkbenchPanel.tsx'
import { MODE_KEY, WorkbenchController, loadMode, loadWidth } from '../src/client/preferences.ts'
import { workbenchTransport } from '../src/client/transport.ts'

afterEach(cleanup)

const sessionId = 'session-a' as never
const WORKBENCH_MODE_FIXTURE: readonly UtilityMode[] = ['review', 'terminal', 'browser', 'files', 'browserSkill']
const labels = {
  open: '打开工作台', close: '关闭工作台', terminal: '终端', browser: '浏览器',
  files: '文件', review: '审阅', workbench: '工作台', modes: '工作台模式', clearView: '清屏', changes: '变更',
  browserSkill: '浏览器技能', browserSkillIdle: '点击“检测”运行内置 CLI 与浏览器扩展状态检查。',
  browserSkillCheck: '检测', browserSkillChecking: '正在检测…', browserSkillBundled: 'CLI 已内置',
  browserSkillMissing: 'CLI 缺失', browserSkillIncompatible: 'CLI 版本不匹配', browserSkillUnhealthy: 'CLI 状态异常',
  browserSkillVersion: '版本 {version}', browserSkillExtensionConnected: '扩展已连接',
  browserSkillExtensionNotConnected: '扩展未连接', browserSkillInstallExtension: '安装官方扩展',
  browserSkillSessions: '会话：自有 {owned} · 借用 {borrowed}', browserSkillSessionFact: '浏览器会话',
  browserSkillFailed: '状态检测失败：{message}',
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

describe('desktop workbench mode registry', () => {
  it('exposes one frozen, uniquely keyed, order-stable tab definition list', () => {
    expect(Object.isFrozen(workbenchModeDefinitions)).toBe(true)
    expect(workbenchModeDefinitions.map(definition => definition.id)).toEqual([
      'review', 'terminal', 'browser', 'files', 'browserSkill',
    ])
    expect(workbenchModeDefinitions.map(definition => definition.order)).toEqual([0, 1, 2, 3, 4])
    expect(new Set(workbenchModeDefinitions.map(definition => definition.id)).size).toBe(5)
  })

  it('keeps every page reachable through the frozen registry', () => {
    // Pages are statically bundled (the client-modules system does not yet
    // materialize dynamic plugin chunks); the panel mounts only the selected
    // definition, so unselected pages never initialize.
    for (const definition of workbenchModeDefinitions) {
      expect(definition.Component).toBeTypeOf('function')
    }
  })

  it('renders only the selected page and loads a page on first selection', async () => {
    const { controller, common } = setup()
    controller.open(sessionId, 'review')
    const panelProps = common as unknown as WorkbenchPanelProps
    const view = render(<WorkbenchPanel {...panelProps} mode="review" />)

    expect(await screen.findByText('变更')).toBeTruthy()
    expect(screen.queryByText('清屏')).toBeNull()
    expect(screen.queryByText('原生浏览器仅在桌面版可用')).toBeNull()
    expect(screen.queryByPlaceholderText('筛选文件')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '终端' }))
    view.rerender(<WorkbenchPanel {...panelProps} mode={controller.getSnapshot().mode} />)
    expect(await screen.findByText('清屏')).toBeTruthy()
    expect(screen.queryByText('变更')).toBeNull()
  })

  it('falls back to terminal for unknown persisted modes', () => {
    expect(loadMode({ getItem: key => key === MODE_KEY ? 'agent-browser' : null })).toBe('terminal')
  })
})

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

  it('opens one docked panel with vertically ordered modes and no duplicate side-chat surface', () => {
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
    const panel = view.container.querySelector('[data-desktop-workbench-panel]')
    expect(panel).not.toBeNull()
    const tablist = screen.getByRole('tablist', { name: '工作台模式' })
    expect(tablist.getAttribute('aria-orientation')).toBe('vertical')
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['审阅', '终端', '浏览器', '文件', '浏览器技能'])
    expect(screen.queryByRole('tab', { name: '侧边聊天' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(panel?.querySelector('kbd')).toBeNull()

    const selected = screen.getByRole('tab', { name: '终端' })
    const modePanel = screen.getByRole('tabpanel')
    expect(selected.getAttribute('aria-selected')).toBe('true')
    expect(selected.getAttribute('aria-controls')).toBe(modePanel.id)
    expect(modePanel.getAttribute('aria-labelledby')).toBe(selected.id)
  })

  it('moves roving focus vertically and selects the focused mode only on Enter', () => {
    const { controller, layout, common } = setup()
    controller.open(sessionId, 'terminal')
    layout.openUtility.mockClear()
    const panelProps = common as unknown as WorkbenchPanelProps
    render(<WorkbenchPanel {...panelProps} mode="terminal" />)
    const review = screen.getByRole('tab', { name: '审阅' })
    const terminal = screen.getByRole('tab', { name: '终端' })
    const browser = screen.getByRole('tab', { name: '浏览器' })
    const files = screen.getByRole('tab', { name: '文件' })
    const browserSkill = screen.getByRole('tab', { name: '浏览器技能' })

    terminal.focus()
    fireEvent.keyDown(terminal, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(browser)
    expect(layout.openUtility).not.toHaveBeenCalled()
    fireEvent.keyDown(browser, { key: 'Home' })
    expect(document.activeElement).toBe(review)
    fireEvent.keyDown(review, { key: 'End' })
    expect(document.activeElement).toBe(browserSkill)
    fireEvent.keyDown(browserSkill, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(files)
    fireEvent.keyDown(files, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(browser)
    fireEvent.keyDown(browser, { key: 'Enter' })
    expect(layout.openUtility).toHaveBeenCalledOnce()
    expect(layout.openUtility).toHaveBeenLastCalledWith('browser')
  })

  it('switches modes without closing and closes the same docked panel on Escape', () => {
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

  it('restores and persists only a valid recent mode without opening the panel', () => {
    expect(loadMode({ getItem: () => 'review' })).toBe('review')
    expect(loadMode({ getItem: () => 'side-chat' })).toBe('terminal')
    expect(loadMode({ getItem: () => null })).toBe('terminal')

    const layout = {
      openUtility: vi.fn(), closeUtility: vi.fn(), toggleUtility: vi.fn(), setUtilityWidth: vi.fn(),
    }
    const storage = { getItem: vi.fn((key: string) => key === MODE_KEY ? 'files' : null), setItem: vi.fn() }
    const controller = new WorkbenchController(layout, storage)
    expect(controller.getSnapshot()).toMatchObject({ open: false, mode: 'files' })
    expect(layout.openUtility).not.toHaveBeenCalled()

    controller.toggle(sessionId)
    expect(layout.openUtility).toHaveBeenLastCalledWith('files')
    controller.selectMode('review')
    expect(storage.setItem).toHaveBeenCalledWith(MODE_KEY, 'review')
    expect(controller.getSnapshot().mode).toBe('review')
  })
})

describe('BrowserSkill status page', () => {
  it('stays idle on mount and probes only on the explicit check', async () => {
    const spy = vi.spyOn(workbenchTransport, 'browserSkillStatus').mockResolvedValue({
      state: 'bundled-ready', cliVersion: '0.1.11', extension: 'not-connected', ownedSessions: 1, borrowedSessions: 2,
    })
    const { common } = setup()
    const props = common as unknown as Parameters<typeof BrowserSkillMode>[0]
    render(<BrowserSkillMode {...props} />)

    expect(screen.getByText('点击“检测”运行内置 CLI 与浏览器扩展状态检查。')).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '检测' }))
    expect(await screen.findByText('CLI 已内置')).toBeTruthy()
    expect(screen.getByText('扩展未连接')).toBeTruthy()
    expect(screen.getByText('浏览器会话')).toBeTruthy()
    expect(spy).toHaveBeenCalledOnce()
    spy.mockRestore()
  })

  it('links only the official HTTPS install page and surfaces probe failures', async () => {
    const spy = vi.spyOn(workbenchTransport, 'browserSkillStatus').mockRejectedValue(new Error('bridge down'))
    const { common } = setup()
    const props = common as unknown as Parameters<typeof BrowserSkillMode>[0]
    render(<BrowserSkillMode {...props} />)

    const link = screen.getByRole('link', { name: '安装官方扩展' })
    expect(link.getAttribute('href')).toBe('https://github.com/Tencent/BrowserSkill#readme')
    expect(link.getAttribute('href')?.startsWith('https://')).toBe(true)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')

    fireEvent.click(screen.getByRole('button', { name: '检测' }))
    expect(await screen.findByText(/状态检测失败/u)).toBeTruthy()
    spy.mockRestore()
  })
})
