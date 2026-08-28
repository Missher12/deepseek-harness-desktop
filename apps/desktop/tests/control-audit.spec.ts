import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ControlAuditLog } from '../src/control/audit.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('local control audit', () => {
  it('HMACs the session and never serializes sensitive sentinel fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-control-audit-'))
    roots.push(root)
    const file = join(root, 'audit.jsonl')
    const audit = new ControlAuditLog({
      filename: file,
      clock: { nowUnixMs: () => 1_700_000_000_000 },
      installSalt: new Uint8Array(32).fill(7),
    })
    await audit.record({
      sessionId: 'SESSION_SENTINEL',
      appId: 'com.example.Editor',
      action: 'lease-granted',
      outcome: 'allowed',
      url: 'URL_SENTINEL',
      title: 'TITLE_SENTINEL',
      text: 'TEXT_SENTINEL',
      path: '/PATH_SENTINEL',
      image: 'IMAGE_SENTINEL',
      token: 'TOKEN_SENTINEL',
    } as never)
    const raw = await readFile(file, 'utf8')
    for (const sentinel of [
      'SESSION_SENTINEL', 'URL_SENTINEL', 'TITLE_SENTINEL', 'TEXT_SENTINEL',
      'PATH_SENTINEL', 'IMAGE_SENTINEL', 'TOKEN_SENTINEL',
    ]) expect(raw).not.toContain(sentinel)
    const row: unknown = JSON.parse(raw)
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError('expected one JSON object audit row')
    }
    expect(Object.keys(row).sort()).toEqual(['action', 'appId', 'outcome', 'sessionHash', 'timeUnixMs'])
    expect(row).toMatchObject({
      timeUnixMs: 1_700_000_000_000,
      appId: 'com.example.Editor',
      action: 'lease-granted',
      outcome: 'allowed',
    })
    expect(raw).toMatch(/"sessionHash":"[0-9a-f]{64}"/)
  })

  it('serializes concurrent writes and rotates to bounded complete rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-control-audit-'))
    roots.push(root)
    const file = join(root, 'audit.jsonl')
    let time = 0
    const audit = new ControlAuditLog({
      filename: file,
      clock: { nowUnixMs: () => ++time },
      installSalt: new Uint8Array(32).fill(9),
      maxRows: 2,
      maxBytes: 2_048,
    })
    await Promise.all(['granted', 'stopped', 'denied'].map((outcome, index) => audit.record({
      sessionId: `session-${index}`,
      appId: null,
      action: 'emergency-stop',
      outcome: outcome as 'granted' | 'stopped' | 'denied',
    })))
    const rows: unknown[] = (await readFile(file, 'utf8')).trim().split('\n').map((line): unknown => {
      const parsed: unknown = JSON.parse(line)
      return parsed
    })
    expect(rows).toHaveLength(2)
    expect(rows).toEqual([
      expect.objectContaining({ outcome: 'stopped' }),
      expect.objectContaining({ outcome: 'denied' }),
    ])
  })

  it('rejects unknown action and outcome vocabulary before writing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-control-audit-'))
    roots.push(root)
    const file = join(root, 'audit.jsonl')
    const audit = new ControlAuditLog({
      filename: file,
      clock: { nowUnixMs: () => 1 },
      installSalt: new Uint8Array(32).fill(1),
    })
    await expect(audit.record({
      sessionId: 'session', appId: null, action: 'page-text', outcome: 'approved',
    } as never)).rejects.toThrow(/audit/i)
  })
})
