/**
 * Workbench tab registry: one frozen, uniquely keyed, order-stable source for
 * every docked Workbench page. Only the selected page mounts; page modules
 * stay statically bundled because the client-modules system does not yet
 * materialize dynamic chunks from plugin bundles.
 * @module @deepseek-ai/dsh-desktop-workbench/client
 */

import type { ComponentType } from 'react'
import type { UtilityMode } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { WorkbenchPanelProps } from './WorkbenchPanel.tsx'
import { ReviewMode } from './ReviewMode.tsx'
import { TerminalMode } from './TerminalMode.tsx'
import { BrowserMode } from './BrowserMode.tsx'
import { FilesMode } from './FilesMode.tsx'

/** One Workbench page definition: identity, presentation order, component. */
export interface DesktopWorkbenchTabDefinition {
  /** Stable utility mode id; also the locale key for the tab label. */
  readonly id: UtilityMode
  /** Ascending presentation order inside the vertical tablist. */
  readonly order: number
  /** Page component; the panel mounts only the selected definition. */
  readonly Component: ComponentType<WorkbenchPanelProps>
}

/** Stable presentation order for the docked Workbench launcher. */
export const WORKBENCH_MODE_ORDER = ['review', 'terminal', 'browser', 'files'] as const satisfies readonly UtilityMode[]

/** Frozen registry; unknown or duplicate ids are rejected by construction. */
export const workbenchModeDefinitions: readonly DesktopWorkbenchTabDefinition[] = Object.freeze([
  { id: 'review', order: 0, Component: ReviewMode },
  { id: 'terminal', order: 1, Component: TerminalMode },
  { id: 'browser', order: 2, Component: BrowserMode },
  { id: 'files', order: 3, Component: FilesMode },
])
