/** Dependencies and deadlines for the Harness readiness probe. */
export interface ReadinessOptions {
  fetch?: typeof globalThis.fetch
  delay?: (ms: number) => Promise<void>
  now?: () => number
  timeoutMs?: number
}

const sleep = async (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const BOOT_MANIFEST_ASSIGNMENT = /(?:window\.__DSH_BOOT__|globalThis\["__DSH_BOOT__"\])\s*=/u

interface BrowserAuthentication {
  readonly cookie: string
  readonly root: string
}

/** Read the exact same-origin root redirect and cookie emitted by BrowserAuth. */
function browserAuthentication(response: Response, requestUrl: string): BrowserAuthentication | undefined {
  if (response.status !== 303) return undefined
  const location = response.headers.get('location')
  const setCookie = response.headers.get('set-cookie')
  if (location === null || setCookie === null) return undefined
  const request = new URL(requestUrl)
  const root = new URL(location, request)
  if (root.origin !== request.origin || root.pathname !== '/' || root.search !== '' || root.hash !== '') {
    return undefined
  }
  const cookie = setCookie.split(';', 1)[0]?.trim()
  if (cookie === undefined || !/^[^=;\s]+=[^;\r\n]+$/u.test(cookie)) return undefined
  return { cookie, root: root.href }
}

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
  let probeUrl = url
  let cookie: string | undefined

  for (;;) {
    try {
      const response = await fetchImpl(probeUrl, {
        ...cookie === undefined ? {} : { headers: { cookie } },
        redirect: 'manual',
        signal: AbortSignal.timeout(1_500),
      })
      if (response.ok && BOOT_MANIFEST_ASSIGNMENT.test(await response.text())) return
      if (cookie === undefined) {
        const authenticated = browserAuthentication(response, probeUrl)
        if (authenticated !== undefined) {
          cookie = authenticated.cookie
          probeUrl = authenticated.root
          continue
        }
      }
    } catch (error) {
      if (now() >= deadline) {
        throw new Error('Harness missed the readiness deadline.', { cause: error })
      }
    }
    if (now() >= deadline) throw new Error('Harness missed the readiness deadline.')
    await delay(100)
  }
}
