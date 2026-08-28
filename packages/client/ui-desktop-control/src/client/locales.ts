export const en = {
  section: 'Browser & Computer Control', sectionDescription: 'Let the Agent work in the built-in browser or authorized Mac apps.',
  capabilityAvailable: 'capability available', capabilitiesAvailable: 'capabilities available',
  available: 'Available', unavailable: 'Unavailable', unknown: 'Unknown', enabled: 'Enabled', notEnabled: 'Not enabled',
  stop: 'Stop', stopping: 'Stopping…', controlActive: 'Computer control active',
  browserControl: 'Browser control', browserDescription: 'Navigate and interact with the visible workbench browser.',
  computerControl: 'Computer control', computerDescription: 'View and control only the Mac apps you authorize.',
  permissions: 'macOS permissions', screenViewing: 'Screen Viewing', assistiveControl: 'Assistive Control',
  granted: 'Granted', denied: 'Denied',
  permissionGuidance: 'Open system settings to grant access. Harness never changes OS permissions automatically.',
  authorizedApps: 'Authorized applications', noApps: 'No ordinary apps available.', emergencyShortcut: 'Emergency Stop shortcut',
  currentControl: 'Current control', idle: 'No Agent control is active.', retryStatus: 'Retry status', retryApps: 'Retry applications',
  settingFailed: 'The setting could not be changed.',
} as const

export type DesktopControlLocaleKey = keyof typeof en
export type DesktopControlLabels = Readonly<Record<DesktopControlLocaleKey, string>>

export const zh: DesktopControlLabels = {
  section: '浏览器与电脑控制', sectionDescription: '允许 Agent 操作内置浏览器或你授权的 Mac 应用。',
  capabilityAvailable: '项能力可用', capabilitiesAvailable: '项能力可用',
  available: '可用', unavailable: '不可用', unknown: '未知', enabled: '已开启', notEnabled: '未开启',
  stop: '停止', stopping: '正在停止…', controlActive: '电脑控制进行中',
  browserControl: '浏览器控制', browserDescription: '在可见的工作台浏览器中浏览并操作。',
  computerControl: '电脑控制', computerDescription: '只查看和控制你明确授权的 Mac 应用。',
  permissions: 'macOS 权限', screenViewing: '屏幕查看', assistiveControl: '辅助控制',
  granted: '已授权', denied: '已拒绝',
  permissionGuidance: '请前往系统设置手动授权。Harness 绝不会自动修改系统权限。',
  authorizedApps: '授权应用', noApps: '没有可用的普通应用。', emergencyShortcut: '紧急停止快捷键',
  currentControl: '当前控制', idle: '当前没有 Agent 正在控制。', retryStatus: '重试状态', retryApps: '重试应用列表',
  settingFailed: '无法修改此设置。',
}
