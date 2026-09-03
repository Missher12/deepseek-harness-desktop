/**
 * Workbench tab registry: one frozen, uniquely keyed, order-stable source for
 * every docked Workbench page. Each page loads lazily so the Terminal,
 * Browser, and Files chunks never enter the bundle until first selection.
 * @module @deepseek-ai/dsh-desktop-workbench/client
 */

import { lazy, type ComponentType } from 'react'
import type { UtilityMode } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { WorkbenchPanelProps } from './WorkbenchPanel.tsx'

/** One Workbench page definition: identity, presentation order, lazy loader. */
export interface DesktopWorkbenchTabDefinition {
  /** Stable utility mode id; also the locale key for the tab label. */
  readonly id: UtilityMode
  /** Ascending presentation order inside the vertical tablist. */
  readonly order: number
  /** Lazy page component; the bundle only resolves it on first selection. */
  readonly Component: ComponentType<WorkbenchPanelProps>
}

/** Stable presentation order for the docked Workbench launcher. */
export const WORKBENCH_MODE_ORDER = ['review', 'terminal', 'browser', 'files'] as const satisfies readonly UtilityMode[]

/** Frozen registry; unknown or duplicate ids are rejected by construction. */
export const workbenchModeDefinitions: readonly DesktopWorkbenchTabDefinition[] = Object.freeze([
  { id: 'review', order: 0, Component: lazy(() => import('./ReviewMode.tsx').then(module => ({ default: module.ReviewMode }))) },
  { id: 'terminal', order: 1, Component: lazy(() => import('./TerminalMode.tsx').then(module => ({ default: module.TerminalMode }))) },
  { id: 'browser', order: 2, Component: lazy(() => import('./BrowserMode.tsx').then(module => ({ default: module.BrowserMode }))) },
  { id: 'files', order: 3, Component: lazy(() => import('./FilesMode.tsx').then(module => ({ default: module.FilesMode }))) },
])
