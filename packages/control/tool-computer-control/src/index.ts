/** Closed Computer Use tools over an optional Desktop-owned ComputerControl provider. @module @deepseek-ai/dsh-tool-computer-control */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-computer-control'
import type {} from '@deepseek-ai/dsh-tools'
import { computerActionTools } from './actions.ts'
import { ComputerToolController } from './controller.ts'
import { computerSnapshotTool } from './snapshot.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-computer-control'
/** The registry is mandatory; ComputerControl remains optional. */
export const inject = ['tools']

/** Register exactly twelve tools for the lifetime of a real ComputerControl provider. */
export function apply(ctx: Context): void {
  ctx.inject(['computerControl'], (computerCtx) => {
    const controller = new ComputerToolController(computerCtx, computerCtx.computerControl)
    computerCtx.tools.register(computerSnapshotTool(computerCtx, controller))
    for (const tool of computerActionTools(computerCtx, controller)) computerCtx.tools.register(tool)
  })
}

export { ComputerToolController } from './controller.ts'
export { computerActionTools } from './actions.ts'
export { computerSnapshotTool } from './snapshot.ts'
