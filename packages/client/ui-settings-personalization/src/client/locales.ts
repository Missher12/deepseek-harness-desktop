/** Simplified Chinese strings for the personalization Settings surface. */
export const zh = {
  section: '个性化',
  title: '个性化',
  subtitle: '这些偏好会从下一次请求起应用到此电脑上的所有聊天。',
  save: '保存',
  saved: '已保存',
  loading: '正在读取个性化设置…',
  loadFailed: '暂时无法读取个性化设置。',
  saveFailed: '无法保存，请重新载入后再试。',
  customTitle: '自定义指令',
  customDescription: '向 DeepSeek Harness 提供适用于此电脑上所有聊天的额外说明和上下文。',
  customPlaceholder: '例如：回答时先给出结论，再说明依据和风险。',
  customCount: '{used} / {limit} UTF-8 字节',
  externalNotice: '已有手动维护的全局指令会原样保留；这里只编辑 Desktop 管理的部分。',
  readOnlyNotice: '这个全局指令文件由 Desktop 外部管理，因此这里只读显示。',
  projectNotice: '项目内的 AGENTS.md 可以提供更具体的项目规则。',
  styleTitle: '回复风格',
  styleDescription: '选择默认语气；自定义指令仍然优先表达你的具体要求。',
  styleDefault: '默认',
  styleConcise: '简洁',
  styleFriendly: '亲和',
  styleProfessional: '专业',
} satisfies Record<string, string>

/** Stable dictionary keys shared by both supported locales. */
export type PersonalizationLocaleKey = keyof typeof zh

/** English strings mirroring every Simplified Chinese dictionary key. */
export const en = {
  section: 'Personalization',
  title: 'Personalization',
  subtitle: 'These preferences apply to every chat on this computer from the next request.',
  save: 'Save',
  saved: 'Saved',
  loading: 'Loading personalization…',
  loadFailed: 'Personalization is temporarily unavailable.',
  saveFailed: 'Could not save. Reload and try again.',
  customTitle: 'Custom instructions',
  customDescription: 'Give DeepSeek Harness extra guidance and context for every chat on this computer.',
  customPlaceholder: 'For example: lead with the conclusion, then explain evidence and risks.',
  customCount: '{used} / {limit} UTF-8 bytes',
  externalNotice: 'Existing manual instructions are preserved; this page edits only the Desktop-managed block.',
  readOnlyNotice: 'This global instruction file is managed outside Desktop, so this page is read-only.',
  projectNotice: 'A project AGENTS.md can provide more specific project rules.',
  styleTitle: 'Reply style',
  styleDescription: 'Choose the default tone; custom instructions still express your specific requirements.',
  styleDefault: 'Default',
  styleConcise: 'Concise',
  styleFriendly: 'Friendly',
  styleProfessional: 'Professional',
} satisfies Record<PersonalizationLocaleKey, string>
