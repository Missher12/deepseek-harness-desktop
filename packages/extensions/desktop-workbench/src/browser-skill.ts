/**
 * Dormant BrowserSkill health probe.
 *
 * Runs only when the Workbench page explicitly refreshes: one `--version`
 * call and one bounded `status --json` call, both shell-free with fixed argv.
 * The returned status is sanitized by construction — no daemon pid, socket
 * path, ws port, cookie, URL, title, screenshot, or session id ever leaves
 * this module. Dispose kills only probe children this module started; the
 * bsk daemon and any foreign session are never signalled.
 * @module @deepseek-ai/dsh-desktop-workbench/browser-skill
 */

import { execFile } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  BSK_PROBE_TIMEOUT_MS,
  MAX_BSK_PROBE_OUTPUT_BYTES,
  type BrowserSkillExtensionState,
  type BrowserSkillHealth,
  type BrowserSkillStatus,
} from './protocol.ts'

/** Exact route for explicit BrowserSkill status refreshes. */
export const BROWSER_SKILL_STATUS_PATH = '/plugins/dsh-desktop-workbench/browser-skill/status'
/** CLI version pinned by scripts/browser-skill-assets.json. */
export const EXPECTED_BSK_VERSION = '0.1.11'

export interface BrowserSkillProbeOptions {
  /** Verified physical CLI path; the probe reports `missing` when absent. */
  cliPath?: string
  /** Platform whose bundled member name to resolve from resources. */
  platform?: NodeJS.Platform
  /** Pinned CLI version; a parsed mismatch reports `incompatible`. */
  expectedVersion?: string
  /** Injectable runner; defaults to a shell-free, timeout-bounded execFile. */
  run?: (command: string, args: readonly string[], timeoutMs: number) => Promise<{ stdout: string }>
  /** Per-command budget; defaults to BSK_PROBE_TIMEOUT_MS. */
  timeoutMs?: number
}

/**
 * Resolve the bundled BrowserSkill CLI only when it is a physical regular
 * file outside app.asar; anything else resolves to undefined.
 */
export function resolveBundledBrowserSkillCli(
  resourcesPath: string,
  platform: NodeJS.Platform,
): string | undefined {
  const member = platform === 'win32' ? 'bsk.exe' : 'bsk'
  const candidate = join(resourcesPath, 'browser-skill', 'bin', member)
  try {
    const real = realpathSync(candidate)
    if (!statSync(real).isFile()) return undefined
    const normalized = real.replaceAll('\\', '/')
    if (normalized.includes('/app.asar/') || normalized.endsWith('/app.asar')) return undefined
    return real
  } catch {
    return undefined
  }
}

function parseCliVersion(output: string): string | undefined {
  return /(?:^|\n)\s*bsk\s+v?(\d+\.\d+\.\d+)/iu.exec(output)?.[1]
}

interface DaemonStatusShape {
  daemon_version?: unknown
  browsers?: unknown
  sessions?: unknown
}

function countSessions(sessions: unknown): { owned: number; borrowed: number } {
  if (!Array.isArray(sessions)) return { owned: 0, borrowed: 0 }
  let owned = 0
  let borrowed = 0
  for (const entry of sessions) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (record.owned === true) owned += 1
    else if (record.borrowed === true) borrowed += 1
  }
  return { owned, borrowed }
}

function notConnected(): Pick<BrowserSkillStatus, 'extension' | 'ownedSessions' | 'borrowedSessions'> {
  return { extension: 'not-connected', ownedSessions: 0, borrowedSessions: 0 }
}

/** Owns the bounded, sanitized status probe for one Workbench lifetime. */
export class BrowserSkillProbe {
  private readonly cliPath: string | undefined
  private readonly expectedVersion: string
  private readonly timeoutMs: number
  private readonly run: (command: string, args: readonly string[], timeoutMs: number) => Promise<{ stdout: string }>
  private readonly children = new Set<ReturnType<typeof execFile>>()
  private disposed = false

  constructor(options: BrowserSkillProbeOptions = {}) {
    this.expectedVersion = options.expectedVersion ?? EXPECTED_BSK_VERSION
    this.timeoutMs = options.timeoutMs ?? BSK_PROBE_TIMEOUT_MS
    this.run = options.run ?? ((command, args, timeoutMs) => new Promise((resolve, reject) => {
      const child = execFile(command, [...args], {
        shell: false,
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: MAX_BSK_PROBE_OUTPUT_BYTES,
      }, (error, stdout) => {
        this.children.delete(child)
        if (error === null) resolve({ stdout })
        else reject(new Error(error.message, { cause: error }))
      })
      this.children.add(child)
    }))
    this.cliPath = options.cliPath
      ?? (typeof (process as NodeJS.Process & { resourcesPath?: unknown }).resourcesPath === 'string'
        ? resolveBundledBrowserSkillCli(
          (process as NodeJS.Process & { resourcesPath?: unknown }).resourcesPath as string,
          options.platform ?? process.platform,
        )
        : undefined)
  }

  /** Kill only in-flight probe children started by this module. */
  dispose(): void {
    this.disposed = true
    for (const child of this.children) child.kill()
    this.children.clear()
  }

  /** Run the bounded, sanitized status probe exactly once. */
  async status(): Promise<BrowserSkillStatus> {
    if (this.disposed) throw new Error('BrowserSkill probe is disposed.')
    const cliPath = this.cliPath
    if (cliPath === undefined) {
      return { state: 'missing', ...notConnected() }
    }
    let versionOutput: string
    try {
      versionOutput = (await this.run(cliPath, ['--version'], this.timeoutMs)).stdout
    } catch {
      return { state: 'unhealthy', ...notConnected() }
    }
    const parsedVersion = parseCliVersion(versionOutput)
    if (parsedVersion === undefined) {
      return { state: 'incompatible', ...notConnected() }
    }
    const version = parsedVersion
    if (version !== this.expectedVersion) {
      return { state: 'incompatible', cliVersion: version, ...notConnected() }
    }
    let parsed: DaemonStatusShape
    try {
      const raw = (await this.run(cliPath, ['status', '--json'], this.timeoutMs)).stdout
      const value = JSON.parse(raw) as unknown
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('status is not an object')
      }
      parsed = value as DaemonStatusShape
    } catch {
      return { state: 'unhealthy', cliVersion: version, ...notConnected() }
    }
    const daemonVersion = typeof parsed.daemon_version === 'string' ? parsed.daemon_version : undefined
    if (daemonVersion !== undefined && daemonVersion !== version) {
      return { state: 'incompatible', cliVersion: version, ...notConnected() }
    }
    const extension: BrowserSkillExtensionState = Array.isArray(parsed.browsers) && parsed.browsers.length > 0
      ? 'connected'
      : 'not-connected'
    const counts = countSessions(parsed.sessions)
    return {
      state: 'bundled-ready',
      cliVersion: version,
      extension,
      ownedSessions: counts.owned,
      borrowedSessions: counts.borrowed,
    }
  }
}

export type { BrowserSkillHealth }
