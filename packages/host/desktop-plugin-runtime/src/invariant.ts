/**
 * Package-owned invariant companion for the Desktop plugin runtime.
 * @module @deepseek-ai/dsh-host-desktop-plugin-runtime/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-desktop-plugin-runtime'

/** Cordis companion plugin name. */
export const name = 'host-desktop-plugin-runtime-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: service lifecycle and operation exclusivity are
 * exercised through the package's real-composition tests. This companion
 * reserves the package in the exhaustive invariant topology.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
