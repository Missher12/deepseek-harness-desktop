/** Package-owned invariant companion for the computer-control seam. @module @deepseek-ai/dsh-computer-control/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-computer-control'

/** Cordis companion plugin name. */
export const name = 'computer-control-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: providers enforce authorization and target freshness at each call. */
const install: InvariantInstaller = () => {}

/**
 * Register computer-control invariant ownership.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
