import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, symlinkSync, readFileSync, linkSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRestartRequest, readRestartRequest, writeRestartReady, readRestartReady } from '../src/update/restart-receipt.ts'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'dsh-restart-test-')); roots.push(root)
  const tx = join(root, 'transaction'); mkdirSync(tx, { mode: 0o700 })
  const executablePath = join(root, 'Desktop'); writeFileSync(executablePath, 'fixture')
  const home = join(root, 'home'); mkdirSync(home)
  const dshHome = join(home, '.dsh'); mkdirSync(dshHome)
  const userData = join(root, 'userData'); mkdirSync(userData)
  const facts = { desktopVersion: '0.6.0', harnessVersion: '0.1.5-rc.2', executablePath, home, dshHome, userData }
  return { root, tx, facts }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
describe('one-shot native restart receipts', () => {
  it('keeps ordinary launches separate and binds ready to the actual Host and main process', async () => {
    const { tx, facts } = fixture()
    expect(await readRestartRequest(undefined, facts)).toBeNull()
    const request = createRestartRequest(tx, facts, 'a'.repeat(32), 'b'.repeat(64), Date.now() + 60_000)
    const handle = await readRestartRequest(request, facts)
    expect(handle).not.toBeNull()
    expect(readRestartReady(request, process.pid)).toBeNull()
    await writeRestartReady(handle!, { ...facts, ownedHostPid: process.pid + 100 })
    expect(readRestartReady(request, process.pid)?.ownedHostPid).toBe(process.pid + 100)
    await expect(writeRestartReady(handle!, { ...facts, ownedHostPid: process.pid + 100 })).rejects.toThrow()
    await expect(readRestartRequest(request, facts)).rejects.toThrow()
  })
  it.each(['desktopVersion', 'harnessVersion', 'home', 'dshHome', 'userData', 'executablePath'] as const)('rejects wrong actual %s', async (key) => {
    const { tx, facts, root } = fixture()
    const request = createRestartRequest(tx, facts, 'a'.repeat(32), 'b'.repeat(64), Date.now() + 60_000)
    const wrong = key.endsWith('Version') ? '9.0.0' : root
    await expect(readRestartRequest(request, { ...facts, [key]: wrong })).rejects.toThrow()
  })
  it('rejects request symlinks, expired requests and modified request bytes', async () => {
    const { tx, facts, root } = fixture()
    const request = createRestartRequest(tx, facts, 'a'.repeat(32), 'b'.repeat(64), Date.now() + 60_000)
    const alias = join(root, 'alias'); symlinkSync(tx, alias)
    await expect(readRestartRequest(join(alias, 'restart-request.json'), facts)).rejects.toThrow()
    const handle = await readRestartRequest(request, facts)
    const bytes = readFileSync(request, 'utf8'); writeFileSync(request, bytes.replace('b'.repeat(64), 'c'.repeat(64)))
    await expect(writeRestartReady(handle!, { ...facts, ownedHostPid: process.pid + 100 })).rejects.toThrow(/changed/)
  })
  it('refuses extra fields, expired requests, and a ready process that differs from the spawned process', async () => {
    const { tx, facts } = fixture()
    const request = createRestartRequest(tx, facts, 'a'.repeat(32), 'b'.repeat(64), Date.now() - 1)
    await expect(readRestartRequest(request, facts)).rejects.toThrow(/expired/)
    const raw = JSON.parse(readFileSync(request, 'utf8')) as Record<string, unknown>; raw.expiresAt = Date.now() + 60_000; raw.argv = ['--unsafe']
    writeFileSync(request, JSON.stringify(raw))
    await expect(readRestartRequest(request, facts)).rejects.toThrow(/request/)
  })
  it.each([{ nonce: '0'.repeat(64) }, { requestSha256: '0'.repeat(64) }, { mainPid: 99 },
    { ownedHostPid: -1 }, { desktopVersion: '9.0.0' }, { unexpected: true }])('rejects altered ready fields %j', async (change) => {
    const { tx, facts } = fixture()
    const request = createRestartRequest(tx, facts, 'a'.repeat(32), 'b'.repeat(64), Date.now() + 60_000)
    const handle = await readRestartRequest(request, facts)
    await writeRestartReady(handle!, { ...facts, ownedHostPid: process.pid + 100 })
    const readyPath = join(tx, 'restart-ready.json')
    const ready = JSON.parse(readFileSync(readyPath, 'utf8')) as Record<string, unknown>
    writeFileSync(readyPath, JSON.stringify({ ...ready, ...change }))
    expect(() => readRestartReady(request, process.pid)).toThrow(/mismatch/)
  })
  it('rejects hard-linked requests and writable transaction directories', async () => {
    const { tx, facts, root } = fixture()
    const request = createRestartRequest(tx, facts, 'a'.repeat(32), 'b'.repeat(64), Date.now() + 60_000)
    linkSync(request, join(root, 'second-name'))
    await expect(readRestartRequest(request, facts)).rejects.toThrow(/Unsafe/)
    chmodSync(tx, 0o755)
    await expect(readRestartRequest(request, facts)).rejects.toThrow(/private/)
  })

})
