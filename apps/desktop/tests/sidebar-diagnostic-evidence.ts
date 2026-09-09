/** Diagnosis-only failure projection: never serialize arbitrary errors or renderer output. */
export interface SidebarDiagnosticFailure {
  classification: 'collapsed-after-click' | 'open-button-unavailable' | 'other'
  messages: string[]
}

/**
 * Retain only known numeric matcher and locator timeout messages from nested smoke errors.
 * @param error - Potentially unsafe exception containing renderer/body/URL diagnostics.
 * @returns Bounded safe evidence; unrecognized details remain private to the runner.
 */
export function sidebarDiagnosticFailure(error: unknown): SidebarDiagnosticFailure {
  const evidence: SidebarDiagnosticFailure = { classification: 'other', messages: [] }
  const visited = new Set<Error>()
  let current = error
  while (current instanceof Error && !visited.has(current) && visited.size < 5) {
    visited.add(current)
    const first = current.message.split('\n')[0]
    if (first === 'expected 1 to be +0 // Object.is equality') {
      evidence.classification = 'collapsed-after-click'
      evidence.messages.push(first)
    } else if (first === 'locator.waitFor: Timeout 15000ms exceeded.') {
      if (evidence.classification === 'other') evidence.classification = 'open-button-unavailable'
      evidence.messages.push(first)
    } else if (first === 'Matcher did not succeed in time.') evidence.messages.push(first)
    current = current.cause
  }
  return evidence
}
