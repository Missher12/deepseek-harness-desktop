import type { ObservableSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ILayout, UtilityMode } from '@deepseek-ai/dsh-client-ui-layout/client'

export const WIDTH_KEY = 'dsh.desktop-workbench.width.v1'
export interface StorageReader { getItem(key: string): string | null }
export interface StorageWriter extends StorageReader { setItem(key: string, value: string): void }
export interface WorkbenchSnapshot { open: boolean; mode: UtilityMode; width: number; sessionId?: SessionId }

export function loadWidth(storage: StorageReader): number {
  const value = Number(storage.getItem(WIDTH_KEY))
  return Number.isFinite(value) ? Math.min(720, Math.max(320, Math.round(value))) : 420
}

export class WorkbenchController implements ObservableSnapshot<WorkbenchSnapshot> {
  #listeners = new Set<() => void>()
  #snapshot: WorkbenchSnapshot

  constructor(private readonly layout: Pick<ILayout, 'openUtility' | 'closeUtility' | 'toggleUtility' | 'setUtilityWidth'>, private readonly storage: StorageWriter) {
    this.#snapshot = { open: false, mode: 'terminal', width: loadWidth(storage) }
    layout.setUtilityWidth(this.#snapshot.width)
  }

  getSnapshot = (): WorkbenchSnapshot => this.#snapshot
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener) } }

  toggle(sessionId: SessionId): void {
    const open = this.#snapshot.sessionId === sessionId ? !this.#snapshot.open : true
    this.#set({ ...this.#snapshot, sessionId, open })
    if (open) this.layout.openUtility(this.#snapshot.mode)
    else this.layout.closeUtility()
  }

  open(sessionId: SessionId, mode: UtilityMode = this.#snapshot.mode): void {
    this.#set({ ...this.#snapshot, sessionId, mode, open: true })
    this.layout.openUtility(mode)
  }

  close(): void { this.#set({ ...this.#snapshot, open: false }); this.layout.closeUtility() }

  selectMode(mode: UtilityMode): void {
    this.#set({ ...this.#snapshot, mode, open: true })
    this.layout.openUtility(mode)
  }

  setWidth(width: number): void {
    const next = Math.min(720, Math.max(320, Math.round(width)))
    this.storage.setItem(WIDTH_KEY, String(next))
    this.#set({ ...this.#snapshot, width: next })
    this.layout.setUtilityWidth(next)
  }

  #set(next: WorkbenchSnapshot): void {
    this.#snapshot = next
    for (const listener of this.#listeners) listener()
  }
}

export interface WorkbenchInjected {
  hooks: { workbench: ObservableSnapshot<WorkbenchSnapshot> }
  toggle(sessionId: SessionId): void
  close(): void
  selectMode(mode: UtilityMode): void
  setWidth(width: number): void
}
