/** Native recovery owns its bilingual copy and consumes only the validated preload face. */
const dictionaries = {
  en: {
    title: 'Plugin compatibility and recovery', plugins: 'Plugins', updates: 'System update',
    description: 'Plugin changes apply after restarting the session service. Your conversations, original configuration, plugin code and data are preserved.',
    refresh: 'Refresh', check: 'Check for updates', download: 'Download update', cancelDownload: 'Cancel download', install: 'Install update',
    empty: 'No optional Bundles have been discovered.', profile: 'Plugin installation: web · Desktop runtime: desktop-base · Configuration edits apply on restart.',
    error: 'The operation could not complete. Refresh the state or inspect the application logs.',
    blocked: 'Configuration needs attention. The session service is stopped; updates remain available.',
    disable: 'Disable and restart', enable: 'Enable and restart', restore: 'Validate, restore and restart', working: 'Applying the change…',
    enabled: 'Enabled', disabled: 'Disabled', healthy: 'Validated', unverified: 'Not validated', suspected: 'Load issue observed', paused: 'Paused',
    installed: 'Installed', harness: 'Included Harness', required: 'Required Bundles',
  },
  zh: {
    title: '插件兼容与恢复', plugins: '插件', updates: '系统更新',
    description: '插件更改在会话服务重启后生效。会话、原配置、插件代码和数据都会保留。',
    refresh: '刷新', check: '检查更新', download: '下载更新', cancelDownload: '取消下载', install: '安装更新',
    empty: '尚未发现可选 Bundle。', profile: '插件安装位置：web · 桌面运行配置：desktop-base · 配置编辑将在重启后生效。',
    error: '操作未能完成。请刷新状态或查看应用日志。',
    blocked: '配置需要处理。会话服务已停止，仍可使用系统更新。',
    disable: '停用并重启', enable: '启用并重启', restore: '验证、恢复并重启', working: '正在应用更改…',
    enabled: '已启用', disabled: '已停用', healthy: '已验证', unverified: '尚未验证', suspected: '发现加载问题', paused: '已暂停',
    installed: '当前桌面', harness: '内置 Harness', required: '必需的 Bundle',
  },
}
const copy = dictionaries[navigator.language.startsWith('zh') ? 'zh' : 'en']
const api = window.dshDesktop
let busy = false
const byId = id => document.getElementById(id)
for (const node of document.querySelectorAll('[data-copy]')) node.textContent = copy[node.dataset.copy]
function notice(text, failed = false) {
  byId('notice').textContent = text
  byId('notice').setAttribute('role', failed ? 'alert' : 'status')
}
async function refreshPlugins() {
  const state = await api.getCompatibility()
  byId('profile').textContent = copy.profile
  const container = byId('plugins')
  container.replaceChildren()
  if (state.recoveryCode !== null) notice(copy.blocked, true)
  if (state.entries.length === 0) container.textContent = copy.empty
  for (const entry of state.entries) {
    const row = document.createElement('div')
    row.className = 'plugin'
    row.dataset.pluginName = entry.name
    const title = document.createElement('strong')
    title.textContent = `${entry.name} · ${entry.version}`
    const status = document.createElement('p')
    status.textContent = `${copy[entry.enabled ? 'enabled' : 'disabled']} · ${copy[entry.health]}`
      + (entry.reason === null ? '' : ` · ${entry.reason}`)
      + (entry.requiredBundles.length === 0 ? '' : ` · ${copy.required}: ${entry.requiredBundles.join(', ')}`)
    const actions = document.createElement('div')
    actions.className = 'actions'
    for (const action of [entry.enabled ? 'disable' : 'enable', ...(entry.health === 'paused' || entry.health === 'suspected' ? ['restore'] : [])]) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = copy[action]
      button.disabled = busy
      button.addEventListener('click', () => {
        void perform(async () => {
          await api.mutatePlugin({ name: entry.name, revision: state.revision, action })
          await refreshPlugins()
        })
      })
      actions.append(button)
    }
    row.append(title, status, actions)
    container.append(row)
  }
}
function showUpdate(state) {
  byId('versions').textContent = `${copy.installed}: ${state.runningDesktop} · ${copy.harness}: ${state.includedHarness}`
  byId('update-state').textContent = state.message ?? state.phase
  byId('download').disabled = busy || state.phase !== 'desktop-available'
  byId('cancel-download').disabled = !['downloading', 'verifying'].includes(state.phase)
  byId('install').disabled = busy || state.phase !== 'ready'
  const progress = byId('progress')
  progress.hidden = state.downloadProgress === null
  if (state.downloadProgress !== null) progress.value = state.downloadProgress
}
async function perform(operation) {
  if (busy) return
  busy = true
  for (const button of document.querySelectorAll('button')) button.disabled = true
  notice(copy.working)
  try { await operation(); if (byId('notice').textContent === copy.working) notice('') } catch { notice(copy.error, true) }
  finally {
    busy = false
    for (const button of document.querySelectorAll('button')) button.disabled = false
    try { showUpdate(await api.getUpdateStatus()) } catch { notice(copy.error, true) }
  }
}
byId('refresh').addEventListener('click', () => { void perform(refreshPlugins) })
byId('cancel-download').addEventListener('click', () => { void api.cancelUpdateDownload().then(showUpdate).catch(() => { notice(copy.error, true) }) })
for (const [id, method] of [['check', 'checkForUpdates'], ['download', 'downloadUpdate'], ['install', 'installUpdate']]) {
  byId(id).addEventListener('click', () => { void perform(async () => { await api[method]() }) })
}
const unsubscribe = api.onUpdateStatus(showUpdate)
window.addEventListener('pagehide', unsubscribe, { once: true })
void refreshPlugins().catch(() => { notice(copy.error, true) })
void api.getUpdateStatus().then(showUpdate).catch(() => { notice(copy.error, true) })
