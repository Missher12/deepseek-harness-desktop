import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** No runtime invariant: bounded terminal, browser, file, and review behavior is enforced at each Host boundary. */
const install: InvariantInstaller = () => {}
export const name = 'desktop-workbench-invariant'
export const inject = ['invariants']
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-desktop-workbench', install))
