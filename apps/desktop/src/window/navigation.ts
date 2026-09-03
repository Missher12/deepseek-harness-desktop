/** Navigation outcomes enforced by the Electron main process. */
export type NavigationDecision = 'internal' | 'external' | 'blocked'

/**
 * Decide one renderer permission without broadening the desktop trust boundary.
 * The UI needs only sanitized clipboard writes for explicit Copy actions. Reads,
 * subframes, foreign origins, and every other Electron permission stay denied.
 * @param permission - Electron permission name.
 * @param requestingUrl - Last URL loaded by the requesting frame.
 * @param isMainFrame - Whether the request came from the top-level app frame.
 * @param ownedRoot - Validated Harness root currently owned by this window.
 * @param trustedWebContents - Whether Electron attributed the request to this window.
 * @returns Whether Electron may grant the request.
 */
export function allowRendererPermission(
  permission: string,
  requestingUrl: string | undefined,
  isMainFrame: boolean,
  ownedRoot: string | undefined,
  trustedWebContents: boolean,
): boolean {
  if (permission !== 'clipboard-sanitized-write' || !isMainFrame || !trustedWebContents) return false
  if (requestingUrl === undefined || ownedRoot === undefined) return false
  try {
    const requesting = new URL(requestingUrl)
    const owned = new URL(ownedRoot)
    return owned.protocol === 'http:'
      && owned.hostname === '127.0.0.1'
      && Number(owned.port) > 0
      && requesting.protocol === owned.protocol
      && requesting.hostname === owned.hostname
      && requesting.port === owned.port
  } catch {
    return false
  }
}

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
