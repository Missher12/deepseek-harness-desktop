import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ILayout, UtilityLayoutSnapshot, UtilityMode } from '@deepseek-ai/dsh-client-ui-layout/client'

/** Observable workbench UI state projected directly from the layout store. */
export type WorkbenchSnapshot = UtilityLayoutSnapshot

/** Thin workbench action/read facade over the layout store's single state source. */
export class WorkbenchController implements ObservableSnapshot<WorkbenchSnapshot> {
  constructor(private readonly layout: ILayout) {}

  getSnapshot = (): WorkbenchSnapshot => this.layout.getSnapshot()
  subscribe = (listener: () => void): (() => void) => this.layout.subscribe(listener)

  /**
   * Toggle the workbench for one session.
   * @param _sessionId - current session retained for the stable workbench API.
   */
  toggle(_sessionId: SessionId): void { this.layout.toggleUtility() }

  /**
   * Open one workbench mode for a session.
   * @param _sessionId - current ordinary session retained for the stable API.
   * @param mode - requested utility mode.
   */
  open(_sessionId: SessionId, mode: UtilityMode = this.layout.getSnapshot().mode): void { this.layout.openUtility(mode) }

  /** Close the utility workbench. */
  close(): void { this.layout.closeUtility() }

  /**
   * Select and keep open one utility mode.
   * @param mode - requested utility mode.
   */
  selectMode(mode: UtilityMode): void { this.layout.openUtility(mode) }

  /**
   * Persist and apply one clamped utility width.
   * @param width - requested utility width in pixels.
   */
  setWidth(width: number): void {
    this.layout.setUtilityWidth(width)
  }
}

/** Workbench services injected into its Client slot entries. */
export interface WorkbenchInjected {
  hooks: { workbench: ObservableSnapshot<WorkbenchSnapshot> }
  toggle(sessionId: SessionId): void
  open(sessionId: SessionId, mode?: UtilityMode): void
  close(): void
  selectMode(mode: UtilityMode): void
  setWidth(width: number): void
}
