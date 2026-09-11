/** Portable native Session evidence contains bounded identifiers and outcomes, never host paths. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'

function keys(value: unknown, expected: readonly string[]): asserts value is Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Receipt object is missing')
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), 'Unexpected receipt fields')
}

function leaf(value: unknown): asserts value is string {
  assert.equal(typeof value, 'string')
  assert(/^[a-z0-9][a-z0-9_-]{0,127}$/.test(value as string), 'Receipt Session id is not a portable leaf')
  assert(!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(value as string), 'Reserved Windows Session id')
}

/**
 * Reject incomplete native acceptance and non-portable fields.
 * @param receipt - Parsed evidence from the shared installed-application smoke.
 */
export function assertSessionWorkspaceReceipt(receipt: unknown): void {
  keys(receipt, ['schemaVersion', 'noProjectSessions', 'independentDirectories', 'continuedSession',
    'sameDirectoryOnReopen', 'outputsPreserved', 'explicitProjectPreserved', 'legacy', 'completedWriteTurns'])
  assert.equal(receipt.schemaVersion, 1)
  assert.equal(receipt.completedWriteTurns, 5)
  for (const name of ['independentDirectories', 'sameDirectoryOnReopen', 'outputsPreserved', 'explicitProjectPreserved']) {
    assert.equal(receipt[name], true, 'Native Session workspace acceptance did not complete')
  }
  assert(Array.isArray(receipt.noProjectSessions) && receipt.noProjectSessions.length === 2)
  const sessions: unknown[] = receipt.noProjectSessions
  const ids: string[] = []
  for (const session of sessions) {
    keys(session, ['id', 'folderName'])
    leaf(session.id)
    assert.equal(session.folderName, session.id)
    ids.push(session.id)
  }
  assert.notEqual(ids[0], ids[1])
  assert.equal(receipt.continuedSession, ids[0])
  keys(receipt.legacy, ['id', 'fromVersion', 'version', 'originalBytesPreserved', 'outputPreserved',
    'reopened', 'originalSha256', 'sourceSha256'])
  leaf(receipt.legacy.id)
  assert.equal(receipt.legacy.fromVersion, 2)
  assert.equal(receipt.legacy.version, 3)
  for (const name of ['originalBytesPreserved', 'outputPreserved', 'reopened']) assert.equal(receipt.legacy[name], true)
  for (const name of ['originalSha256', 'sourceSha256']) {
    const digest: unknown = receipt.legacy[name]
    assert(typeof digest === 'string', 'Receipt SHA-256 must be text')
    assert(/^[a-f0-9]{64}$/.test(digest), 'Invalid receipt SHA-256')
  }
}

/**
 * Validate the bounded regular file before adding it to an artifact.
 * @param path - Explicit native receipt file produced by the successful smoke.
 * @returns Its observed size and digest for the containing evidence manifest.
 */
export async function verifySessionWorkspaceReceipt(path: string): Promise<{ size: number; sha256: string }> {
  const info = await lstat(path)
  assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, 'Receipt must be a physical regular file')
  assert(info.size > 0 && info.size <= 4096, 'Receipt size is invalid')
  const bytes = await readFile(path)
  assert.equal(bytes.length, info.size, 'Receipt changed while reading')
  const receipt: unknown = JSON.parse(bytes.toString('utf8'))
  assertSessionWorkspaceReceipt(receipt)
  return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}
