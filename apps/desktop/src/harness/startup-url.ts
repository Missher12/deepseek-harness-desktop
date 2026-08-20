const STARTUP_PREFIX = 'dsh web: '
const STARTUP_ERROR = 'Harness did not report one valid loopback startup URL.'

/**
 * Return the one validated loopback URL printed by the owned Harness child.
 * @param output - Accumulated standard output from the child.
 * @returns The normalized loopback root URL.
 */
export function readHarnessUrl(output: string): string {
  const lines = output.split(/\r?\n/u).filter(line => line.startsWith(STARTUP_PREFIX))
  const candidates = lines.flatMap((line) => {
    let candidate: URL
    try {
      candidate = new URL(line.slice(STARTUP_PREFIX.length))
    } catch {
      return []
    }
    const port = Number(candidate.port)
    if (
      candidate.protocol !== 'http:'
      || candidate.hostname !== '127.0.0.1'
      || candidate.pathname !== '/'
      || candidate.search !== ''
      || candidate.hash !== ''
      || !Number.isInteger(port)
      || port < 1
      || port > 65_535
    ) return []
    return [candidate.href]
  })
  const candidate = candidates[0]
  if (candidates.length !== 1 || candidate === undefined) throw new Error(STARTUP_ERROR)
  return candidate
}
