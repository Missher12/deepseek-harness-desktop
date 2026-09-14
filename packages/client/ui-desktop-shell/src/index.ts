/** Native adapter announces the official launcher's successful Host startup commit. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cmdline'

/** The supported profile launcher owns this readiness service. */
export const inject = ['appReady']

/**
 * Emit readiness only after the official loader activation audit and startup setup succeed.
 * @param ctx Native profile context; disposal cancels an outstanding announcement.
 */
export function apply(ctx: Context): void {
  const ready = ctx.appReady
  if (ready === undefined) throw new Error('Desktop native shell requires official application readiness.')
  ctx.effect(() => ready.onReady(() => { console.info('dsh desktop: host-ready') }), 'desktop native Host readiness')
}
