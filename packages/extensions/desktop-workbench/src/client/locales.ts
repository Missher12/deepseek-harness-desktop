export const NS = 'desktopWorkbench'
export const zh = {
  open: '打开工作台', close: '关闭工作台', terminal: '终端', browser: '浏览器', files: '文件',
  'side-chat': '侧边聊天', review: '审阅',
  'placeholder.terminal': '终端正在准备', 'placeholder.browser': '浏览器正在准备',
  'placeholder.files': '文件正在准备', 'placeholder.side-chat': '侧边聊天正在准备',
  'placeholder.review': '审阅正在准备',
  currentSession: '当前会话 ID', copy: '复制', copied: '已复制', copyFailed: '复制失败',
  targetSession: '目标会话 ID', targetPlaceholder: '粘贴另一个普通会话 ID', message: '消息',
  wake: '启动目标 Agent', send: '发送', sending: '发送中', sent: '消息已投递', sendFailed: '消息投递失败',
  recent: '最近通信', noRecent: '暂无通信记录', reply: '回复', cancelReply: '取消回复',
  connectionError: '通信连接异常：{error}',
} as const
export const en: Record<keyof typeof zh, string> = {
  open: 'Open workbench', close: 'Close workbench', terminal: 'Terminal', browser: 'Browser', files: 'Files',
  'side-chat': 'Side chat', review: 'Review',
  'placeholder.terminal': 'Terminal is getting ready', 'placeholder.browser': 'Browser is getting ready',
  'placeholder.files': 'Files are getting ready', 'placeholder.side-chat': 'Side chat is getting ready',
  'placeholder.review': 'Review is getting ready',
  currentSession: 'Current Session ID', copy: 'Copy', copied: 'Copied', copyFailed: 'Copy failed',
  targetSession: 'Target Session ID', targetPlaceholder: 'Paste another ordinary Session ID', message: 'Message',
  wake: 'Start target Agent', send: 'Send', sending: 'Sending', sent: 'Message delivered', sendFailed: 'Message could not be delivered',
  recent: 'Recent activity', noRecent: 'No session messages yet', reply: 'Reply', cancelReply: 'Cancel reply',
  connectionError: 'Message connection error: {error}',
}
export type DesktopWorkbenchKey = keyof typeof zh
