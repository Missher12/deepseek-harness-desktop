/** Dependencies and deadlines for the Harness readiness probe. */
export interface ReadinessOptions {
  fetch?: typeof globalThis.fetch
  delay?: (ms: number) => Promise<void>
  now?: () => number
  timeoutMs?: number
}

const sleep = async (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const BOOT_MANIFEST_ASSIGNMENT = /(?:window\.__DSH_BOOT__|globalThis\["__DSH_BOOT__"\])\s*=/u

/**
 * The alpha.5 Web Host authenticates index requests through a process launch
 * token: `GET /?token=...` answers `303 See Other` to `/` while minting the
 * session cookie. A cookie-less probe must treat that exchange as readiness
 * instead of following the redirect into an unauthenticated response.
 * @param response - One manual-redirect response from the loopback host.
 * @returns Whether the response is the token-exchange handshake.
 */
function isAuthExchange(response: Response): boolean {
  return response.status === 303 && response.headers.get('location') === '/'
}

/**
 * Wait until the owned Web Host serves the authenticated root: either the
 * alpha.5 token exchange, or a complete boot-manifest page.
 * @param url - Validated loopback root URL.
 * @param options - Injectable transport, clock, delay, and deadline.
 * @returns A promise that settles when the Web Host is ready.
 */
export async function waitForHarness(url: string, options: ReadinessOptions = {}): Promise<void> {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const delay = options.delay ?? sleep
  const now = options.now ?? Date.now
  const deadline = now() + (options.timeoutMs ?? 20_000)

  for (;;) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(1_500), redirect: 'manual' })
      if (isAuthExchange(response)) return
      if (response.ok && BOOT_MANIFEST_ASSIGNMENT.test(await response.text())) return
    } catch (error) {
      if (now() >= deadline) {
        throw new Error('Harness missed the readiness deadline.', { cause: error })
      }
    }
    if (now() >= deadline) throw new Error('Harness missed the readiness deadline.')
    await delay(100)
  }
}
