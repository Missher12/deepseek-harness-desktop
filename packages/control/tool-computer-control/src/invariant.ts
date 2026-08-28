/** Package invariant companion for the Computer Use tool Consumer. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-computer-control'
/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-computer-control-invariant'
/** Service required to reserve invariant ownership. */
export const inject = ['invariants']
/** No runtime invariant: provider authority and tool registration lifetimes own all mutable state. */
const install: InvariantInstaller = () => {}
/** Reserve package invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
