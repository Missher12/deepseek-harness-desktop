/** Native Desktop dialogs and tray copy use the operating-system locale. */

const en = {
  setupMessage: 'Close the application and open Setup?',
  setupDetail: 'Save your work first. After the app exits, the visible Windows Setup wizard will ask you to confirm installation.',
  cancel: 'Cancel',
  openSetup: 'Close and open Setup',
  show: 'Show DeepSeek Harness',
  quit: 'Quit',
  pluginMessage: 'Apply plugin changes and restart the session service?',
  pluginDetail: 'Active generations and tools will stop. Sessions, plugin code and data are preserved.',
  pluginApply: 'Apply and restart',
  recoveryMenu: 'Recovery',
  recoveryOpen: 'Plugin recovery and system update…',
} as const

type NativeCopy = Readonly<Record<keyof typeof en, string>>

const zh: NativeCopy = {
  setupMessage: '关闭应用并打开安装向导？',
  setupDetail: '请先保存工作。应用退出后会显示 Windows 安装向导；仍需你在向导中确认安装。',
  cancel: '取消',
  openSetup: '关闭并打开安装向导',
  show: '显示 DeepSeek Harness',
  quit: '退出',
  pluginMessage: '应用插件更改并重启会话服务？',
  pluginDetail: '正在进行的生成和工具任务将停止。会话、插件代码和数据会保留。',
  pluginApply: '应用并重启',
  recoveryMenu: '恢复',
  recoveryOpen: '插件恢复与系统更新…',
}

/**
 * Select the native copy supported by Desktop.
 * @param language - Electron's operating-system locale.
 * @returns Chinese copy for zh locales, otherwise English.
 */
export function nativeDesktopCopy(language: string): NativeCopy {
  return language.startsWith('zh') ? zh : en
}
