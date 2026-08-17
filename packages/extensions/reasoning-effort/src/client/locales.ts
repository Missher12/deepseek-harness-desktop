/** Simplified Chinese dictionary (the source key set). */
export const zh = {
  'trigger.fallback': '选择模型',
  'trigger.aria': '选择模型，当前 {model}，推理等级 {effort}',
  'popup.aria': '模型与推理等级',
  'effort.aria': '推理等级',
  'effort.title': '推理等级',
  'effort.unavailable': '当前模型未提供可调节的推理等级。',
  'model.title': '模型',
  'model.loading': '正在刷新模型列表…',
  'model.empty': '没有可用模型。',
  'error.staleRoute': '模型目录已变化，请重新选择。',
  'error.staleEffort': '该推理等级已变化，请重新选择。',
  'error.action': '模型操作失败：{message}',
  'character.label': '角色滑块',
  'character.on': '已开启',
  'character.off': '已关闭',
  'character.failed': '角色滑块设置保存失败。',
} satisfies Record<string, string>

/** Locale key union owned by this plugin. */
export type ReasoningEffortKey = keyof typeof zh

/** English dictionary, complete against the Chinese source key set. */
export const en = {
  'trigger.fallback': 'Select model',
  'trigger.aria': 'Select model, current {model}, reasoning effort {effort}',
  'popup.aria': 'Model and reasoning effort',
  'effort.aria': 'Reasoning effort',
  'effort.title': 'Reasoning effort',
  'effort.unavailable': 'This model does not provide adjustable reasoning effort.',
  'model.title': 'Model',
  'model.loading': 'Refreshing model list…',
  'model.empty': 'No models available.',
  'error.staleRoute': 'The model directory changed. Choose again.',
  'error.staleEffort': 'That reasoning effort changed. Choose again.',
  'error.action': 'Model operation failed: {message}',
  'character.label': 'Character thumb',
  'character.on': 'On',
  'character.off': 'Off',
  'character.failed': 'Could not save the character-thumb setting.',
} satisfies Record<ReasoningEffortKey, string>
