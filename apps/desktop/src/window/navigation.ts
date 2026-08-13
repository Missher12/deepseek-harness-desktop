/** Navigation outcomes enforced by the Electron main process. */
export type NavigationDecision = 'internal' | 'external' | 'blocked'

/**
 * Classify one renderer navigation against the exact owned Harness origin.
 * @param target - Requested renderer URL.
 * @param ownedRoot - Validated Harness root URL.
 * @returns Whether to keep, hand off, or block the navigation.
 */
export function classifyNavigation(target: string, ownedRoot: string): NavigationDecision {
  let targetUrl: URL
  let owned: URL
  try {
    targetUrl = new URL(target)
    owned = new URL(ownedRoot)
  } catch {
    return 'blocked'
  }
  if (targetUrl.origin === owned.origin) return 'internal'
  if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') return 'blocked'
  if (targetUrl.hostname === '127.0.0.1' || targetUrl.hostname === 'localhost') return 'blocked'
  return 'external'
}
