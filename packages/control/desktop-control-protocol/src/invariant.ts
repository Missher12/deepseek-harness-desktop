/** Package-owned companion for the pure Desktop-control protocol. @module @deepseek-ai/dsh-desktop-control-protocol/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { assertProtocolManifest } from './manifest.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-desktop-control-protocol'

/** Cordis companion plugin name. */
export const name = 'desktop-control-protocol-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime relation exists for this pure wire library. Loading its companion
 * still verifies that the TypeScript constants match the published v1 manifest.
 */
const install: InvariantInstaller = (_ctx, fail) => {
  try {
    assertProtocolManifest()
  } catch (error) {
    fail(error instanceof Error ? error.message : 'desktop-control protocol manifest validation failed')
  }
}

/** Register package ownership after checking its static protocol invariant. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
