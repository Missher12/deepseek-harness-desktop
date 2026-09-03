import { appendFile, chmod, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const REDACTED = '[REDACTED_SECRET]'
const ASSIGNMENT = /(?<![?&])\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=(?:"[^"]*"|'[^']*'|[^\s]+)/giu
const BEARER = /(Authorization:\s*Bearer\s+)[^\s]+/giu
const JSON_CREDENTIAL = /("(?:apiKey|api_key|token|secret|password|authorization)"\s*:\s*")[^"]*(")/giu
const QUERY_CREDENTIAL = /([?&](?:api_key|token|secret|password)=)[^&\s]+/giu

/**
 * Remove common credential values from one lifecycle message.
 * @param text - Untrusted runtime output or an application lifecycle fact.
 * @returns Text safe for the owner-only lifecycle log.
 */
export function redactLogText(text: string): string {
  return text
    .replace(ASSIGNMENT, `$1=${REDACTED}`)
    .replace(BEARER, `$1${REDACTED}`)
    .replace(JSON_CREDENTIAL, `$1${REDACTED}$2`)
    .replace(QUERY_CREDENTIAL, `$1${REDACTED}`)
}

/** Narrow lifecycle logger that serializes owner-only file appends. */
export interface LifecycleLogger {
  /**
   * Append one timestamped, redacted record.
   * @param message - Lifecycle metadata or captured runtime output.
   * @returns A promise that settles after the line reaches the file.
   */
  write(message: string): Promise<void>
}

/** Optional clock used by deterministic log tests. */
export interface LifecycleLoggerOptions {
  now?: () => Date
}

/**
 * Create an owner-only lifecycle logger.
 * @param logPath - Controlled path below Electron's application data directory.
 * @param options - Optional deterministic clock.
 * @returns A serialized lifecycle writer.
 */
export function createLifecycleLogger(
  logPath: string,
  options: LifecycleLoggerOptions = {},
): LifecycleLogger {
  const now = options.now ?? (() => new Date())
  let queue = Promise.resolve()
  return {
    write(message) {
      const operation = queue.catch(() => undefined).then(async () => {
        const directory = dirname(logPath)
        await mkdir(directory, { recursive: true, mode: 0o700 })
        await chmod(directory, 0o700)
        const safe = redactLogText(message).replace(/\r?\n/gu, '\\n')
        await appendFile(logPath, `${now().toISOString()} ${safe}\n`, { encoding: 'utf8', mode: 0o600 })
        await chmod(logPath, 0o600)
      })
      queue = operation
      return operation
    },
  }
}
