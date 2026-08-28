/** Invariant registration for the closed BrowserControl tool package. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-browser-control'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-browser-control-invariant'
/** Service required before this package can reserve invariant ownership. */
export const inject = ['invariants']

/** Runtime invariants are owned by the provider and registry; this package has no independent state to inspect. */
const install: InvariantInstaller = () => {}

/** Reserve this package's invariant ownership with an intentionally inert installer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
