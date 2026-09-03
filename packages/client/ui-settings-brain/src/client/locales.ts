/** Simplified Chinese copy for the Memory & Learning settings overview. */
export const zh = {
  section: '记忆与学习',
  title: '记忆与学习',
  subtitle: '在本机召回经过审核的项目事实，并复用已经验证有效的工作方法。',
  projectMemory: '项目记忆',
  projectMemoryDescription: '保存已审核的事实、决定与长期进度，并按项目隔离召回。',
  evolution: '学到的工作流程',
  evolutionDescription: '只从成功结果中学习工作方法，经过验证后才会在后续任务中复用。',
  ready: '已启用',
  disabled: '已关闭',
  unavailable: '暂不可用',
  bundled: '已内置',
  items: '{count} 条记忆',
  rules: '{count} 条规则',
  recallTitle: '工作原理',
  recallDescription: '仅在顶层会话第一步按当前项目召回；超时或故障时会跳过，不阻塞回复。',
  limits: '最多 {items} 条 · {kilobytes} KB · {timeout} ms 超时放行',
  consolidationTitle: '安全学习',
  consolidationDescription: '只整理同一项目内已审核的重复记忆，并只启用经过验证的工作流程；来源和原记录始终保留。',
  localOnly: '记忆库保存在本机 · 每次模型请求最多发送 6 条 / 4 KB 经选择的片段 · 数据库不打进安装包',
  compatibilityNote: '已有旧记忆库时仅做只读兼容；没有旧数据也不影响新记忆。',
  error: '暂时无法读取记忆与学习状态；消息仍会按安全降级策略继续发送。',
  loading: '正在读取…',
} satisfies Record<string, string>

/** Stable locale keys shared by every Memory & Learning dictionary. */
export type BrainSettingsLocaleKey = keyof typeof zh

/** English copy matching every Memory & Learning locale key. */
export const en = {
  section: 'Memory & Learning',
  title: 'Memory & Learning',
  subtitle: 'Recall reviewed project facts stored on this device and reuse working methods that have been validated.',
  projectMemory: 'Project memory',
  projectMemoryDescription: 'Recall reviewed facts, decisions, and durable progress within the matching project only.',
  evolution: 'Learned workflows',
  evolutionDescription: 'Learn working methods only from successful outcomes; validated workflows can help with later tasks.',
  ready: 'Enabled',
  disabled: 'Disabled',
  unavailable: 'Unavailable',
  bundled: 'Built in',
  items: '{count} memories',
  rules: '{count} rules',
  recallTitle: 'How it works',
  recallDescription: 'Recall runs on the first step of a top-level session and stays within the current project; failure or timeout never blocks the reply.',
  limits: 'Up to {items} items · {kilobytes} KB · {timeout} ms fail-open',
  consolidationTitle: 'Safe learning',
  consolidationDescription: 'Only reviewed duplicate memory in the same project is consolidated, and only validated workflows are enabled; sources and original records remain available.',
  localOnly: 'Memory stores stay on this device · up to 6 selected excerpts / 4 KB may be sent with each model request · databases are not bundled in the installer',
  compatibilityNote: 'Existing legacy memory is read-only; new memory works without legacy data.',
  error: 'Memory & Learning status is temporarily unavailable; messages continue with safe fail-open behavior.',
  loading: 'Reading…',
} satisfies Record<BrainSettingsLocaleKey, string>
