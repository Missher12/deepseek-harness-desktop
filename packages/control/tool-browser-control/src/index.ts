/** Closed semantic browser tools over an optional Desktop-owned BrowserControl provider. @module @deepseek-ai/dsh-tool-browser-control */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-browser-control'
import type {} from '@deepseek-ai/dsh-tools'
import { browserActionTools } from './actions.ts'
import { BrowserToolController } from './controller.ts'
import { browserSnapshotTool } from './snapshot.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-browser-control'

/** The registry is mandatory; BrowserControl remains an optional composition seam. */
export const inject = ['tools']

/** Register all twelve tools only for the lifetime of an actual BrowserControl provider. */
export function apply(ctx: Context): void {
  ctx.inject(['browserControl'], (browserCtx) => {
    const provider = browserCtx.browserControl
    const controller = new BrowserToolController(browserCtx, provider)
    browserCtx.tools.register(browserSnapshotTool(browserCtx, controller))
    for (const tool of browserActionTools(controller)) browserCtx.tools.register(tool)
  })
}

export { BrowserToolController } from './controller.ts'
export { browserActionTools } from './actions.ts'
export { browserSnapshotTool } from './snapshot.ts'
