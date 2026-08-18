/** Package-owned invariant companion. @module @deepseek-ai/dsh-client-ui-settings-usage/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-usage'

export const name = 'client-ui-settings-usage-invariant'
export const inject = ['invariants']
/**
 * No runtime invariant: the package owns one read-only Settings registration,
 * and its component validates every Remote state before presentation.
 */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
