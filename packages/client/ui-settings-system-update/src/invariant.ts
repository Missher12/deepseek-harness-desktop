/** Package-owned invariant companion. @module @deepseek-ai/dsh-client-ui-settings-system-update/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-system-update'

export const name = 'client-ui-settings-system-update-invariant'
export const inject = ['invariants']
/** No runtime invariant: the Desktop bridge and Electron main process own update policy. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
