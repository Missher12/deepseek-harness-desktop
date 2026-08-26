import type { BindingRecord, OwnerRecord } from './state.ts'

/** Workspace catalog fact safe to expose to the paired owner. */
export interface WorkspaceRow {
  workspaceId: string
  title: string
  path: string
  sessionIds: string[]
}

/** Session catalog fact used to select only ordinary matching Sessions. */
export interface SessionRow {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  parentSessionId?: string
  origin?: 'subagent'
  cwd?: string
}

/** Harness catalog and resolver surface required by the binding controller. */
export interface BindingCatalog {
  listWorkspaces(): Promise<{ items: WorkspaceRow[]; archivedSessionIds: string[] }>
  listSessions(): Promise<SessionRow[]>
  resolveOrdinarySession(sessionId: string): Promise<{ id: string; cwd?: string }>
}

/** Durable single-owner binding persistence surface. */
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

  /**
   * List the current Harness projects.
   * @returns Current projects in Harness catalog order with full paths.
   */
  async listProjects(): Promise<Array<{ workspaceId: string; title: string; path: string }>> {
    const { items } = await this.catalog.listWorkspaces()
    return items.map(({ workspaceId, title, path }) => ({ workspaceId, title, path }))
  }

  /**
   * List selectable ordinary Sessions for one project.
   * @param workspaceId - Exact current workspace identifier.
   * @returns Revalidated Sessions with running entries first.
   */
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

  /**
   * Persist a revalidated owner/project/Session binding.
   * @param workspaceId - Exact selected workspace identifier.
   * @param sessionId - Exact selected ordinary Session identifier.
   * @returns The new durable binding generation.
   */
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
    return this.persist(owner, workspace, sessionId)
  }

  /**
   * Bind the exact ordinary Session just committed by the Host create API.
   * Unlike the user picker, a newly created Session may still be blank.
   * @param workspaceId - Workspace passed to the successful create request.
   * @param sessionId - Exact Session identity returned by that request.
   * @returns The new durable binding generation.
   */
  async bindCreated(workspaceId: string, sessionId: string): Promise<BindingRecord> {
    const owner = await this.getOwner()
    if (owner === undefined) throw new Error('Lark owner is not paired')
    const [workspaces, sessions] = await Promise.all([
      this.catalog.listWorkspaces(), this.catalog.listSessions(),
    ])
    const workspace = workspaces.items.find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) throw new Error('Lark project is no longer available')
    if (!workspace.sessionIds.includes(sessionId)) {
      throw new Error('Created Lark Session is not attached to the selected workspace')
    }
    if (workspaces.archivedSessionIds.includes(sessionId)) {
      throw new Error('Created Lark Session is archived')
    }
    const selected = sessions.find(item => item.sessionId === sessionId)
    if (selected === undefined || selected.origin === 'subagent' || selected.parentSessionId !== undefined) {
      throw new Error('Created Lark Session is not ordinary')
    }
    if (selected.cwd === undefined || canonical(selected.cwd) !== canonical(workspace.path)) {
      throw new Error('Created Lark Session working directory changed')
    }
    const resolved = await this.catalog.resolveOrdinarySession(sessionId)
    if (resolved.id !== sessionId || resolved.cwd === undefined
      || canonical(resolved.cwd) !== canonical(workspace.path)) {
      throw new Error('Created Lark Session working directory changed')
    }
    return this.persist(owner, workspace, sessionId)
  }

  /**
   * Read and revalidate the current active binding.
   * @returns The active binding, or undefined when absent or paused.
   */
  async active(): Promise<BindingRecord | undefined> {
    const binding = await this.recover()
    return binding?.state === 'active' ? binding : undefined
  }

  /**
   * Revalidate a persisted binding during startup.
   * @returns The recovered binding, paused when its target no longer validates.
   */
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
      const sessions = await this.catalog.listSessions()
      const archived = new Set(workspaces.archivedSessionIds)
      const selected = sessions.find(item => item.sessionId === binding.sessionId)
      if (!workspace.sessionIds.includes(binding.sessionId) || archived.has(binding.sessionId)
        || selected === undefined || selected.origin === 'subagent'
        || selected.parentSessionId !== undefined || selected.cwd === undefined
        || canonical(selected.cwd) !== canonical(binding.projectPath)) {
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

  /**
   * Remove the current binding without touching its Session.
   * @param _message - Optional command payload retained for router compatibility.
   */
  async unbind(_message?: unknown): Promise<void> {
    await this.store.delete()
  }

  /**
   * Render the current binding status for the paired owner.
   * @param _message - Optional command payload retained for router compatibility.
   * @returns A bounded owner-facing status line.
   */
  async statusText(_message?: unknown): Promise<string> {
    const binding = await this.store.get()
    if (binding === undefined) return '尚未绑定项目和会话。发送 / 进入选择。'
    if (binding.state === 'paused') {
      return `已暂停 ${binding.projectPath} · ${binding.sessionId}。发送 / 重新选择。`
    }
    return `已绑定 ${binding.projectPath} · ${binding.sessionId}`
  }

  private async persist(
    owner: OwnerRecord,
    workspace: WorkspaceRow,
    sessionId: string,
  ): Promise<BindingRecord> {
    const previous = await this.store.get()
    const now = this.now()
    const binding: BindingRecord = {
      id: 'owner', ownerOpenId: owner.openId, chatId: owner.chatId,
      workspaceId: workspace.workspaceId, projectPath: workspace.path, sessionId,
      generation: (previous?.generation ?? 0) + 1,
      state: 'active', boundAt: now, updatedAt: now,
    }
    await this.store.put(binding)
    return binding
  }
}
