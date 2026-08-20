export const NS = 'desktopWorkbench'
export const zh = {
  open: '打开工作台', close: '关闭工作台', terminal: '终端', browser: '浏览器', files: '文件',
  'side-chat': '侧边聊天', review: '审阅',
  'placeholder.terminal': '终端正在准备', 'placeholder.browser': '浏览器正在准备',
  'placeholder.files': '文件正在准备', 'placeholder.side-chat': '侧边聊天正在准备',
  'placeholder.review': '审阅正在准备',
} as const
export const en: Record<keyof typeof zh, string> = {
  open: 'Open workbench', close: 'Close workbench', terminal: 'Terminal', browser: 'Browser', files: 'Files',
  'side-chat': 'Side chat', review: 'Review',
  'placeholder.terminal': 'Terminal is getting ready', 'placeholder.browser': 'Browser is getting ready',
  'placeholder.files': 'Files are getting ready', 'placeholder.side-chat': 'Side chat is getting ready',
  'placeholder.review': 'Review is getting ready',
}
export type DesktopWorkbenchKey = keyof typeof zh
