/** Package-owned invariant companion for the Desktop control Host provider. @module @deepseek-ai/dsh-desktop-control-host/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-desktop-control-host'

/** Cordis companion plugin name. */
export const name = 'desktop-control-host-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: strict frame decoding, ledger limits, and exact
 * generation guards enforce the Host transport contract at its live boundary.
 */
const install: InvariantInstaller = () => {}

/** Register Host-provider invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
