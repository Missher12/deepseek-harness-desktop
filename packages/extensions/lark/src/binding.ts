import type { BindingRecord, OwnerRecord } from './state.ts'

export interface WorkspaceRow {
  workspaceId: string
  title: string
  path: string
  sessionIds: string[]
}

export interface SessionRow {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  parentSessionId?: string
  origin?: 'subagent'
  cwd?: string
}

export interface BindingCatalog {
  listWorkspaces(): Promise<{ items: WorkspaceRow[]; archivedSessionIds: string[] }>
  listSessions(): Promise<SessionRow[]>
  resolveOrdinarySession(sessionId: string): Promise<{ id: string; cwd?: string }>
}

export interface BindingStore {
  get(): Promise<BindingRecord | undefined>
  put(binding: BindingRecord): Promise<void>
  delete(): Promise<void>
}

const canonical = (path: string): string => path.replaceAll('\\', '/').replace(/\/+$/, '')

/** Project/session catalog and one exact durable owner binding. */
export class BindingController {
  constructor(
    private readonly catalog: BindingCatalog,
    private readonly store: BindingStore,
    private readonly getOwner: () => Promise<OwnerRecord | undefined>,
    private readonly now: () => number = Date.now,
  ) {}

  async listProjects(): Promise<Array<{ workspaceId: string; title: string; path: string }>> {
    const { items } = await this.catalog.listWorkspaces()
    return items.map(({ workspaceId, title, path }) => ({ workspaceId, title, path }))
  }

  async listSessions(workspaceId: string): Promise<SessionRow[]> {
    const [workspaces, sessions] = await Promise.all([
      this.catalog.listWorkspaces(), this.catalog.listSessions(),
    ])
    const workspace = workspaces.items.find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) throw new Error('Lark project is no longer available')
    const archived = new Set(workspaces.archivedSessionIds)
    const byId = new Map(sessions.map(session => [session.sessionId, session]))
    return workspace.sessionIds
      .map(id => byId.get(id))
      .filter((row): row is SessionRow => row !== undefined
        && !archived.has(row.sessionId)
        && !row.blank
        && row.origin !== 'subagent'
        && row.parentSessionId === undefined
        && row.cwd !== undefined
        && canonical(row.cwd) === canonical(workspace.path))
      .sort((left, right) => Number(right.running) - Number(left.running))
  }

  async bind(workspaceId: string, sessionId: string): Promise<BindingRecord> {
    const owner = await this.getOwner()
    if (owner === undefined) throw new Error('Lark owner is not paired')
    const workspaces = await this.catalog.listWorkspaces()
    const workspace = workspaces.items.find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) throw new Error('Lark project is no longer available')
    const selectable = await this.listSessions(workspaceId)
    const selected = selectable.find(item => item.sessionId === sessionId)
    if (selected === undefined) throw new Error('Lark Session is not selectable')
    const resolved = await this.catalog.resolveOrdinarySession(sessionId)
    if (resolved.id !== sessionId || resolved.cwd === undefined
      || canonical(resolved.cwd) !== canonical(workspace.path)) {
      throw new Error('Lark Session working directory changed')
    }
    const previous = await this.store.get()
    const now = this.now()
    const binding: BindingRecord = {
      id: 'owner', ownerOpenId: owner.openId, chatId: owner.chatId,
      workspaceId, projectPath: workspace.path, sessionId,
      generation: (previous?.generation ?? 0) + 1,
      state: 'active', boundAt: now, updatedAt: now,
    }
    await this.store.put(binding)
    return binding
  }

  async recover(): Promise<BindingRecord | undefined> {
    const binding = await this.store.get()
    if (binding === undefined) return undefined
    try {
      const owner = await this.getOwner()
      if (owner === undefined || owner.openId !== binding.ownerOpenId || owner.chatId !== binding.chatId) {
        throw new Error('owner changed')
      }
      const workspaceId = binding.workspaceId
      if (workspaceId === undefined) throw new Error('workspace identity missing')
      const workspaces = await this.catalog.listWorkspaces()
      const workspace = workspaces.items.find(item => item.workspaceId === workspaceId)
      if (workspace === undefined || canonical(workspace.path) !== canonical(binding.projectPath)) {
        throw new Error('project changed')
      }
      if (!(await this.listSessions(workspaceId)).some(item => item.sessionId === binding.sessionId)) {
        throw new Error('session changed')
      }
      const target = await this.catalog.resolveOrdinarySession(binding.sessionId)
      if (target.cwd === undefined || canonical(target.cwd) !== canonical(binding.projectPath)) {
        throw new Error('cwd changed')
      }
      return binding
    } catch {
      const paused: BindingRecord = { ...binding, state: 'paused', updatedAt: this.now() }
      await this.store.put(paused)
      return paused
    }
  }

  async unbind(_message?: unknown): Promise<void> {
    await this.store.delete()
  }

  async statusText(_message?: unknown): Promise<string> {
    const binding = await this.store.get()
    if (binding === undefined) return '尚未绑定项目和会话。发送 / 进入选择。'
    return `${binding.state === 'active' ? '已绑定' : '已暂停'} ${binding.projectPath} · ${binding.sessionId}`
  }
}
