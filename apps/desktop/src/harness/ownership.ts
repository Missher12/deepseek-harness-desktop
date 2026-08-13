import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

const EXEC_MAX_BUFFER = 4 * 1024 * 1024

/** Process record returned by the macOS process table. */
export interface ProcessRecord {
  pid: number
  command: string
}

/** Conflicting writer details safe for a closed startup error surface. */
export type HarnessConflict = ProcessRecord

/** Injectable process and open-file discovery seams. */
export interface OwnershipDependencies {
  listProcesses?: () => Promise<readonly ProcessRecord[]>
  listOpenFiles?: (pid: number) => Promise<readonly string[]>
  canonicalize?: (path: string) => Promise<string>
  ownPid?: number
}

function execText(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolveText, reject) => {
    execFile(file, [...args], { encoding: 'utf8', maxBuffer: EXEC_MAX_BUFFER }, (error, stdout) => {
      if (error !== null) {
        reject(error instanceof Error ? error : new Error('Process inspection failed.', { cause: error }))
        return
      }
      resolveText(stdout)
    })
  })
}

async function listProcesses(): Promise<readonly ProcessRecord[]> {
  const stdout = await execText('/bin/ps', ['-axo', 'pid=,command='])
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
  const tokens = command.trim().split(/\s+/u)
  const webIndex = tokens.indexOf('web')
  if (webIndex < 1) return false
  const entry = tokens[webIndex - 1]
  if (entry === undefined) return false
  return entry === 'dsh'
    || entry.endsWith('/dsh')
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
 * @param dependencies - Injectable macOS discovery seams.
 * @returns The first conflicting writer, if one is observed.
 */
export async function findConflictingHarness(
  dshHome: string,
  dependencies: OwnershipDependencies = {},
): Promise<HarnessConflict | undefined> {
  const processLister = dependencies.listProcesses ?? listProcesses
  const openFileLister = dependencies.listOpenFiles ?? listOpenFiles
  const canonicalizer = dependencies.canonicalize ?? canonicalize
  const ownPid = dependencies.ownPid ?? process.pid
  const canonicalHome = await canonicalizer(dshHome)

  for (const processRecord of await processLister()) {
    if (processRecord.pid === ownPid || !isDshWebCommand(processRecord.command)) continue
    for (const filename of await openFileLister(processRecord.pid)) {
      const canonicalFile = await canonicalizer(filename)
      if (isWithin(canonicalHome, canonicalFile)) return processRecord
    }
  }
  return undefined
}
