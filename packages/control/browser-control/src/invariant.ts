/** Package-owned invariant companion for the browser-control seam. @module @deepseek-ai/dsh-browser-control/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-browser-control'

/** Cordis companion plugin name. */
export const name = 'browser-control-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: each provider validates owner-bound refs and bounded results before publication. */
const install: InvariantInstaller = () => {}

/**
 * Register browser-control invariant ownership.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
