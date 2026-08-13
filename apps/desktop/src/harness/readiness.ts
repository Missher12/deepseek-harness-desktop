/** Dependencies and deadlines for the Harness readiness probe. */
export interface ReadinessOptions {
  fetch?: typeof globalThis.fetch
  delay?: (ms: number) => Promise<void>
  now?: () => number
  timeoutMs?: number
}

const sleep = async (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Wait until the owned Web Host serves a complete boot-manifest page.
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
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(1_500) })
      if (response.ok && (await response.text()).includes('window.__DSH_BOOT__')) return
    } catch (error) {
      if (now() >= deadline) {
        throw new Error('Harness missed the readiness deadline.', { cause: error })
      }
    }
    if (now() >= deadline) throw new Error('Harness missed the readiness deadline.')
    await delay(100)
  }
}
