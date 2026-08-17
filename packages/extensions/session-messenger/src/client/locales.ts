/** Localized copy for the compact session messenger footer entry. */

export const NS = 'sessionMessenger' as const

export const en = {
  trigger: 'Session messages',
  triggerLabel: 'Session messages, {unread} unread, {pending} pending',
  panelTitle: 'Session messages',
  pending: '{count} pending',
  unread: '{count} unread',
  latestError: 'Latest error: {error}',
  noError: 'No recent errors',
  copy: 'Copy current Session ID',
  copied: 'Session ID copied',
  copyFailed: 'Copy failed',
  markRead: 'Mark read',
  markedRead: 'Notifications marked read',
  ackFailed: 'Could not mark notifications read',
  noSession: 'Open an ordinary session to copy its ID',
  close: 'Close session messages',
} as const

export type SessionMessengerKey = keyof typeof en

export const zh = {
  trigger: '会话通信',
  triggerLabel: '会话通信，{unread} 条未读，{pending} 条待处理',
  panelTitle: '会话通信',
  pending: '{count} 条待处理',
  unread: '{count} 条未读',
  latestError: '最近错误：{error}',
  noError: '暂无最近错误',
  copy: '复制当前会话 ID',
  copied: '会话 ID 已复制',
  copyFailed: '复制失败',
  markRead: '标为已读',
  markedRead: '通知已标为已读',
  ackFailed: '无法标记通知',
  noSession: '请先打开一个普通会话再复制 ID',
  close: '关闭会话通信',
} as const satisfies Record<SessionMessengerKey, string>
