/** Desktop workbench locale namespace. */
export const NS = 'desktopWorkbench'
/** Simplified-Chinese workbench copy. */
export const zh = {
  open: '打开工作台', close: '关闭工作台', workbench: '工作台', modes: '工作台模式', terminal: '终端', browser: '浏览器', files: '文件',
  review: '审阅', browserSkill: '插件', browserSkillTitle: 'BrowserSkill',
  'placeholder.terminal': '终端正在准备', 'placeholder.browser': '浏览器正在准备',
  'placeholder.files': '文件正在准备', 'placeholder.review': '审阅正在准备', 'placeholder.browserSkill': '浏览器技能正在准备',
  filterFiles: '筛选文件', selectFile: '选择文件以预览', binaryFile: '二进制文件不提供文本预览', truncated: '内容过长，已截断', mention: '加入输入框',
  changes: '变更', refresh: '刷新', noChanges: '没有待审阅的变更', selectChange: '选择变更以查看差异', noDiff: '该文件暂无可显示的差异',
  reviewInChat: '在聊天中审阅', reviewDraft: '请审阅当前工作区中的 {path}，重点检查正确性、稳定性和潜在回归。',
  terminalTab: '终端 {index}', clearView: '清屏', terminalReady: '终端已就绪', terminalPlaceholder: '输入命令并按回车', terminalInterrupt: '⌃C',
  browserDesktopOnly: '原生浏览器仅在桌面版可用', browserPlaceholder: '搜索或输入网址', browserNewTab: '输入网址开始浏览',
  back: '后退', forward: '前进', reload: '刷新', stop: '停止',
  browserSkillIdle: '点击“检测”运行内置 CLI 与浏览器扩展状态检查。', browserSkillCheck: '检测', browserSkillChecking: '正在检测…',
  browserSkillBundled: 'CLI 已内置', browserSkillMissing: 'CLI 缺失', browserSkillIncompatible: 'CLI 版本不匹配', browserSkillUnhealthy: 'CLI 状态异常',
  browserSkillVersion: '版本 {version}', browserSkillCliFact: '浏览器技能 CLI', browserSkillExtensionConnected: '扩展已连接', browserSkillExtensionNotConnected: '扩展未连接',
  browserSkillInstallExtension: '安装官方扩展', browserSkillSessions: '会话：自有 {owned} · 借用 {borrowed}',
  browserSkillSessionFact: '浏览器会话', browserSkillFailed: '状态检测失败：{message}',
  openDesignTitle: 'Open Design', openDesignInstalled: '已通过官方插件配置安装',
  openDesignMissing: '未在 open-design 配置中安装', openDesignLoading: '正在读取插件状态…',
  openDesignFailed: '无法读取插件状态', openDesignOfficial: '查看官方项目',
} as const
/** English workbench copy. */
export const en: Record<keyof typeof zh, string> = {
  open: 'Open workbench', close: 'Close workbench', workbench: 'Workbench', modes: 'Workbench modes', terminal: 'Terminal', browser: 'Browser', files: 'Files',
  review: 'Review', browserSkill: 'Plugins', browserSkillTitle: 'BrowserSkill',
  'placeholder.terminal': 'Terminal is getting ready', 'placeholder.browser': 'Browser is getting ready',
  'placeholder.files': 'Files are getting ready', 'placeholder.review': 'Review is getting ready', 'placeholder.browserSkill': 'BrowserSkill is getting ready',
  filterFiles: 'Filter files', selectFile: 'Select a file to preview', binaryFile: 'Binary preview is unavailable', truncated: 'Content truncated', mention: 'Add to composer',
  changes: 'Changes', refresh: 'Refresh', noChanges: 'No changes to review', selectChange: 'Select a change to view its diff', noDiff: 'No displayable diff for this file',
  reviewInChat: 'Review in chat', reviewDraft: 'Review {path} in the current workspace for correctness, stability, and regressions.',
  terminalTab: 'Terminal {index}', clearView: 'Clear', terminalReady: 'Terminal ready', terminalPlaceholder: 'Type a command and press Return', terminalInterrupt: '⌃C',
  browserDesktopOnly: 'The native Browser is available in Desktop only', browserPlaceholder: 'Search or enter address', browserNewTab: 'Enter an address to browse',
  back: 'Back', forward: 'Forward', reload: 'Reload', stop: 'Stop',
  browserSkillIdle: 'Select "Check" to run the bundled CLI and browser extension status check.', browserSkillCheck: 'Check', browserSkillChecking: 'Checking…',
  browserSkillBundled: 'CLI bundled', browserSkillMissing: 'CLI missing', browserSkillIncompatible: 'CLI version mismatch', browserSkillUnhealthy: 'CLI unhealthy',
  browserSkillVersion: 'Version {version}', browserSkillCliFact: 'BrowserSkill CLI', browserSkillExtensionConnected: 'Extension connected', browserSkillExtensionNotConnected: 'Extension not connected',
  browserSkillInstallExtension: 'Install official extension', browserSkillSessions: 'Sessions: {owned} owned · {borrowed} borrowed',
  browserSkillSessionFact: 'Browser sessions', browserSkillFailed: 'Status check failed: {message}',
  openDesignTitle: 'Open Design', openDesignInstalled: 'Installed through the official plugin profile',
  openDesignMissing: 'Not installed in the open-design profile', openDesignLoading: 'Reading plugin status…',
  openDesignFailed: 'Plugin status is unavailable', openDesignOfficial: 'View official project',
}
/** Closed workbench locale key set. */
export type DesktopWorkbenchKey = keyof typeof zh

/** Untranslated transport failure fallback: thrown errors stay English repository-wide. */
export const REQUEST_FAILED_FALLBACK = 'workbench request failed'
