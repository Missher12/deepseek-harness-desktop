export const en = {
  section: 'Browser & Computer Control', loaded: 'Loaded', unavailable: 'Unavailable',
  stop: 'Stop', stopping: 'Stopping…', controlActive: 'Computer control active',
  computerControl: 'Computer control', screenViewing: 'Screen Viewing',
  assistiveControl: 'Assistive Control', granted: 'Granted', denied: 'Denied', unknown: 'Unknown',
  permissionGuidance: 'Open system settings to grant access. Harness never changes OS permissions automatically.',
  authorizedApps: 'Authorized apps', noApps: 'No ordinary apps available.', emergencyShortcut: 'Emergency shortcut',
} as const

export type DesktopControlLocaleKey = keyof typeof en
export type DesktopControlLabels = Readonly<Record<DesktopControlLocaleKey, string>>

export const zh: DesktopControlLabels = {
  section: '浏览器与电脑控制', loaded: '已加载', unavailable: '不可用',
  stop: '停止', stopping: '正在停止…', controlActive: '电脑控制进行中',
  computerControl: '电脑控制', screenViewing: '屏幕查看',
  assistiveControl: '辅助控制', granted: '已授权', denied: '已拒绝', unknown: '未知',
  permissionGuidance: '请前往系统设置手动授权。Harness 绝不会自动修改系统权限。',
  authorizedApps: '已授权应用', noApps: '没有可用的普通应用。', emergencyShortcut: '紧急停止快捷键',
}
