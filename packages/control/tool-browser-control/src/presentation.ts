/** Replay-safe generic render intents for browser tool activity. */

import type { GenericCallView } from '@deepseek-ai/dsh-tools'

/**
 * Build a compact pending card that never repeats typed text or protected page content.
 * @param title fixed action title shown in the activity card.
 * @param rawInput optional bounded non-sensitive input summary.
 * @returns a generic replay-safe call presentation.
 */
export function browserCall(title: string, rawInput?: string | number): GenericCallView {
  return {
    card: 'generic',
    title,
    kind: 'other',
    ...(rawInput === undefined ? {} : { rawInput }),
  }
}
