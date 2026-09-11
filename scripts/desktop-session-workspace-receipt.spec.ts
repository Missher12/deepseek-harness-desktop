import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { assertSessionWorkspaceReceipt, verifySessionWorkspaceReceipt } from './desktop-session-workspace-receipt.ts'

const valid = () => ({
  schemaVersion: 1,
  noProjectSessions: [{ id: 'session-one', folderName: 'session-one' }, { id: 'session-two', folderName: 'session-two' }],
  independentDirectories: true, continuedSession: 'session-one', sameDirectoryOnReopen: true,
  outputsPreserved: true, explicitProjectPreserved: true, completedWriteTurns: 5,
  legacy: { id: 'legacy', fromVersion: 2, version: 3, originalBytesPreserved: true,
    outputPreserved: true, reopened: true, originalSha256: 'a'.repeat(64), sourceSha256: 'b'.repeat(64) },
})

it.each([
  { ...valid(), cwd: '/private/path' },
  { ...valid(), noProjectSessions: [{ id: '../one', folderName: '../one' }, valid().noProjectSessions[1]] },
  { ...valid(), noProjectSessions: [{ id: 'con', folderName: 'con' }, valid().noProjectSessions[1]] },
  { ...valid(), noProjectSessions: [valid().noProjectSessions[0], valid().noProjectSessions[0]] },
  { ...valid(), continuedSession: 'session-two' },
  { ...valid(), sameDirectoryOnReopen: false },
  { ...valid(), outputsPreserved: false },
  { ...valid(), completedWriteTurns: 4 },
  { ...valid(), legacy: { ...valid().legacy, cwd: 'C:\\private' } },
  { ...valid(), legacy: { ...valid().legacy, version: 2 } },
  { ...valid(), legacy: { ...valid().legacy, originalSha256: 'invalid' } },
  { ...valid(), legacy: { ...valid().legacy, reopened: false } },
  { ...valid(), legacy: undefined },
])('rejects unsafe or incomplete native evidence: %#', (receipt) => {
  expect(() => { assertSessionWorkspaceReceipt(receipt) }).toThrow()
})

it('reads a completed receipt, binds its actual bytes, and refuses oversized or missing evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-receipt-'))
  try {
    const path = join(root, 'native.json')
    const bytes = JSON.stringify(valid())
    await writeFile(path, bytes)
    const checked = await verifySessionWorkspaceReceipt(path)
    expect(checked.size).toBe(Buffer.byteLength(bytes))
    expect(checked.sha256).toMatch(/^[a-f0-9]{64}$/)
    await writeFile(path, ' '.repeat(4097))
    await expect(verifySessionWorkspaceReceipt(path)).rejects.toThrow('size')
    await expect(verifySessionWorkspaceReceipt(join(root, 'missing.json'))).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})
