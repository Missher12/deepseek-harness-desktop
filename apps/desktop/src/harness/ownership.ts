import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

const EXEC_MAX_BUFFER = 4 * 1024 * 1024

/** macOS process-table query narrowed to commands that can contain the `web` subcommand. */
export const MAC_DSH_PROCESS_QUERY = {
  file: '/usr/bin/pgrep',
  args: ['-lf', 'web'],
  noMatchExitCode: 1,
} as const

/** Process record returned by the host process table. */
export interface ProcessRecord {
  pid: number
  command: string
}

/** Conflicting writer details safe for a closed startup error surface. */
export type HarnessConflict = ProcessRecord

/** Injectable process and open-file discovery seams. */
export interface OwnershipDependencies {
  platform?: NodeJS.Platform
  listProcesses?: () => Promise<readonly ProcessRecord[]>
  listOpenFiles?: (pid: number) => Promise<readonly string[]>
  canonicalize?: (path: string) => Promise<string>
  ownPid?: number
}

function execText(file: string, args: readonly string[], allowedExitCodes: readonly number[] = []): Promise<string> {
  return new Promise((resolveText, reject) => {
    execFile(file, [...args], { encoding: 'utf8', maxBuffer: EXEC_MAX_BUFFER }, (error, stdout) => {
      if (error !== null) {
        const code = (error as { code?: string | number }).code
        if (typeof code === 'number' && allowedExitCodes.includes(code)) {
          resolveText(stdout)
          return
        }
        reject(error instanceof Error ? error : new Error('Process inspection failed.', { cause: error }))
        return
      }
      resolveText(stdout)
    })
  })
}

/** Parse POSIX `pid command` process rows. */
export function parsePosixProcesses(stdout: string): ProcessRecord[] {
  const records: ProcessRecord[] = []
  for (const line of stdout.split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line)
    if (match === null) continue
    const pid = Number(match[1])
    const command = match[2]
    if (Number.isSafeInteger(pid) && pid > 0 && command !== undefined) records.push({ pid, command })
  }
  return records
}

async function listMacProcesses(): Promise<readonly ProcessRecord[]> {
  const query = MAC_DSH_PROCESS_QUERY
  const stdout = await execText(query.file, query.args, [query.noMatchExitCode])
  return parsePosixProcesses(stdout)
}

async function listPosixProcesses(): Promise<readonly ProcessRecord[]> {
  return parsePosixProcesses(await execText('/bin/ps', ['-axo', 'pid=,command=']))
}

/**
 * Parse the JSON array emitted by the Windows PowerShell process query.
 * @param output - Compressed JSON written by ConvertTo-Json.
 * @returns Valid positive process identifiers and non-empty command lines.
 */
export function parseWindowsProcesses(output: string): ProcessRecord[] {
  const value: unknown = JSON.parse(output)
  if (value === null) return []
  if (!Array.isArray(value)) throw new Error('Windows process inspection returned invalid JSON.')
  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error('Windows process inspection returned an invalid process record.')
    }
    const pid = (entry as { pid?: unknown }).pid
    const command = (entry as { command?: unknown }).command
    if (!Number.isSafeInteger(pid) || (pid as number) <= 0
      || typeof command !== 'string' || command.length === 0) {
      throw new Error('Windows process inspection returned an invalid process record.')
    }
    return { pid: pid as number, command }
  })
}

/** Build the one-line PowerShell process query without inserting pipe-breaking semicolons. */
export function windowsProcessQuery(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$processes = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | Select-Object @{Name='pid';Expression={[int]$_.ProcessId}}, @{Name='command';Expression={$_.CommandLine}})",
    'ConvertTo-Json -InputObject $processes -Compress',
  ].join('; ')
}

async function listWindowsProcesses(): Promise<readonly ProcessRecord[]> {
  const script = windowsProcessQuery()
  const stdout = await execText('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ])
  return parseWindowsProcesses(stdout)
}

async function listOpenFiles(pid: number): Promise<readonly string[]> {
  try {
    const stdout = await execText('/usr/sbin/lsof', ['-Fn', '-p', String(pid)])
    return stdout.split(/\r?\n/u).filter(line => line.startsWith('n/')).map(line => line.slice(1))
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 1 || code === '1') return []
    throw error
  }
}

async function canonicalize(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return resolve(path)
  }
}

function isDshWebCommand(command: string): boolean {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/gu)?.map(token =>
    token.replace(/^(?:"|')|(?:"|')$/gu, '')) ?? []
  const webIndex = tokens.findIndex(token => token.toLowerCase() === 'web')
  if (webIndex < 1) return false
  const entry = tokens[webIndex - 1]?.replace(/\\/gu, '/').toLowerCase()
  if (entry === undefined) return false
  return entry === 'dsh' || entry === 'dsh.cmd' || entry === 'dsh.exe'
    || entry.endsWith('/dsh')
    || entry.endsWith('/dsh.cmd')
    || entry.endsWith('/dsh.exe')
    || entry.endsWith('/.bin/dsh')
    || entry.endsWith('/@deepseek-ai/dsh/lib/bin.js')
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

/**
 * Find another local dsh Web Host that has the same Harness home open.
 * @param dshHome - Exact resolved data root the desktop child would use.
 * @param dependencies - Injectable host discovery seams.
 * @returns The first conflicting writer, if one is observed.
 */
export async function findConflictingHarness(
  dshHome: string,
  dependencies: OwnershipDependencies = {},
): Promise<HarnessConflict | undefined> {
  const platform = dependencies.platform ?? process.platform
  const processLister = dependencies.listProcesses
    ?? (platform === 'win32' ? listWindowsProcesses
      : platform === 'darwin' ? listMacProcesses
        : listPosixProcesses)
  const openFileLister = dependencies.listOpenFiles ?? listOpenFiles
  const canonicalizer = dependencies.canonicalize ?? canonicalize
  const ownPid = dependencies.ownPid ?? process.pid
  const canonicalHome = platform === 'win32' ? undefined : await canonicalizer(dshHome)

  for (const processRecord of await processLister()) {
    if (processRecord.pid === ownPid || !isDshWebCommand(processRecord.command)) continue
    if (platform === 'win32') return processRecord
    for (const filename of await openFileLister(processRecord.pid)) {
      const canonicalFile = await canonicalizer(filename)
      if (canonicalHome !== undefined && isWithin(canonicalHome, canonicalFile)) return processRecord
    }
  }
  return undefined
}
