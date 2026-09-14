/** Native shell copy; no model or pricing policy belongs to this namespace. */
export const en = {
  settings: 'Settings',
  closeTitle: 'When closing the window',
  keepRunning: 'Keep running in the background',
  quit: 'Quit the application',
  loading: 'Loading…',
  error: 'Unable to update the window setting.',
  retry: 'Retry',
  recoveryTitle: 'Plugin compatibility and recovery',
  recoveryOpen: 'Open recovery',
  recoveryError: 'Unable to open native recovery.',
}
/** Locale keys owned by the native Desktop shell. */
export type DesktopShellKey = keyof typeof en
/** Chinese translations for native window and recovery controls. */
export const zh: Record<DesktopShellKey, string> = {
  settings: '设置',
  closeTitle: '关闭窗口时',
  keepRunning: '在后台继续运行',
  quit: '退出应用',
  loading: '正在加载…',
  error: '无法更新窗口设置。',
  retry: '重试',
  recoveryTitle: '插件兼容与恢复',
  recoveryOpen: '打开恢复页',
  recoveryError: '无法打开原生恢复页。',
}
