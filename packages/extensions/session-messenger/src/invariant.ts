/** Package invariant companion for the removable session messenger plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-messenger'

/** Cordis companion plugin name. */
export const name = 'session-messenger-invariant'
/** Required invariant registry. */
export const inject = ['invariants']

/** No runtime invariant: route, receipt, and session ownership are covered by package tests. */
const install: InvariantInstaller = () => {}

/** Reserve package invariant ownership for this plugin. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
