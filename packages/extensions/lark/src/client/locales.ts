/** Simplified Chinese labels for the Lark settings section. */
export const zh = {
  section: '飞书远程开发',
  title: '飞书远程开发',
  enabled: '插件状态', connected: '连接状态', pairing: '所有者配对', binding: '当前绑定', queue: '远程队列',
  appId: 'App ID', appSecret: 'App Secret', saveCredentials: '保存凭据',
  pairingCode: '配对码', pair: '确认配对',
  enable: '启用', disable: '停用', active: '已启用', disabled: '已停用', resume: '恢复队列', clear: '清除数据', repair: '重新配对',
  paired: '已配对', unpaired: '未配对', online: '已连接', offline: '未连接',
  confirmClear: '确定清除飞书插件的绑定和队列数据吗？', confirmRepair: '确定重新配对飞书所有者吗？',
} satisfies Record<string, string>
/** Stable locale keys shared by both settings dictionaries. */
export type LarkLocaleKey = keyof typeof zh
/** English labels for the Lark settings section. */
export const en = {
  section: 'Lark Remote Development', title: 'Lark Remote Development',
  enabled: 'Plugin status', connected: 'Connection', pairing: 'Owner pairing', binding: 'Current binding', queue: 'Remote queue',
  appId: 'App ID', appSecret: 'App Secret', saveCredentials: 'Save credentials',
  pairingCode: 'Pairing code', pair: 'Pair owner',
  enable: 'Enable', disable: 'Disable', active: 'Enabled', disabled: 'Disabled', resume: 'Resume queue', clear: 'Clear data', repair: 'Re-pair',
  paired: 'Paired', unpaired: 'Unpaired', online: 'Connected', offline: 'Disconnected',
  confirmClear: 'Clear Lark binding and queue data?', confirmRepair: 'Re-pair the Lark owner?',
} satisfies Record<LarkLocaleKey, string>
