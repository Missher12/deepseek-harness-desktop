/** Package invariant companion for the removable Lark remote-session plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-lark'

export const name = 'lark-invariant'
export const inject = ['invariants']

/** No runtime invariant: transport, queue, binding, and disposal ownership are covered by composition tests. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
