/** Replay-safe render intents for Computer Use activity. */

import type { GenericCallView } from '@deepseek-ai/dsh-tools'

/**
 * Build a compact card that never repeats typed text or captured content.
 * @param title fixed action title shown in the activity card.
 * @param rawInput optional bounded non-sensitive input summary.
 * @returns a generic replay-safe call presentation.
 */
export function computerCall(title: string, rawInput?: string | number): GenericCallView {
  return {
    card: 'generic',
    title,
    kind: 'other',
    ...(rawInput === undefined ? {} : { rawInput }),
  }
}
