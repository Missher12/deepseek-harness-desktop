const STARTUP_PREFIX = 'dsh web: '
const STARTUP_ERROR = 'Harness did not report one valid loopback startup URL.'
const TOKEN_PARAM = 'token'
const BASE64URL_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/u

/**
 * The alpha.5 Web Host authenticates index requests through a process launch
 * token carried in the query string. Accept that exact form, plus the
 * tokenless rc.2 form, and reject every other parameter shape so the Desktop
 * only ever loads one validated loopback root.
 * @param candidate - Parsed loopback root candidate.
 * @returns Whether the candidate carries an acceptable token query, if any.
 */
function hasAcceptableTokenQuery(candidate: URL): boolean {
  if (candidate.search === '') return true
  const entries = [...candidate.searchParams]
  if (entries.some(([name]) => name !== TOKEN_PARAM)) return false
  const tokens = candidate.searchParams.getAll(TOKEN_PARAM)
  const token = tokens[0]
  return tokens.length === 1 && token !== undefined && token !== '' && BASE64URL_TOKEN_PATTERN.test(token)
}

/**
 * Return the one validated loopback URL printed by the owned Harness child.
 * @param output - Accumulated standard output from the child.
 * @returns The normalized loopback root URL, including its launch token.
 */
export function readHarnessUrl(output: string): string {
  const lines = output.split(/\r?\n/u).filter(line => line.startsWith(STARTUP_PREFIX))
  const candidates = lines.flatMap((line) => {
    // The announced line may append a ` (LAN: ...)` handoff after the root URL.
    const firstField = line.slice(STARTUP_PREFIX.length).split(/\s/u)[0] ?? ''
    let candidate: URL
    try {
      candidate = new URL(firstField)
    } catch {
      return []
    }
    const port = Number(candidate.port)
    if (
      candidate.protocol !== 'http:'
      || candidate.hostname !== '127.0.0.1'
      || candidate.pathname !== '/'
      || candidate.hash !== ''
      || !Number.isInteger(port)
      || port < 1
      || port > 65_535
      || !hasAcceptableTokenQuery(candidate)
    ) return []
    return [candidate.href]
  })
  const candidate = candidates[0]
  if (candidates.length !== 1 || candidate === undefined) throw new Error(STARTUP_ERROR)
  return candidate
}
