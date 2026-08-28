/** Replay-safe generic render intents for browser tool activity. */

import type { GenericCallView } from '@deepseek-ai/dsh-tools'

/** A compact pending card that never repeats typed text or protected page content. */
export function browserCall(title: string, rawInput?: string | number): GenericCallView {
  return {
    card: 'generic',
    title,
    kind: 'other',
    ...(rawInput === undefined ? {} : { rawInput }),
  }
}
