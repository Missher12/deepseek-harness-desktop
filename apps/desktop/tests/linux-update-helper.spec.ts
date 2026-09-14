import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { link, unlink, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLinuxUpdateHelper, waitForLinuxParentExit } from '../src/update/linux-update-helper.ts'
import { parseLinuxHelperRequest, readLinuxUpdateRecord, validateLinuxRestartEnvironment, writeLinuxUpdateRecord } from '../src/update/linux-update-protocol.ts'
import { recoverLinuxInstall } from '../src/update/linux-install-backend.ts'
import { finishAppImageReplacement, prepareAppImageReplacement } from '../src/update/linux-appimage-replace.ts'

describe('independent Linux helper control', () => {
  it('treats PID reuse as departure of the old parent without signalling the new process', async () => {
    await expect(waitForLinuxParentExit({ pid: 23, startTime: '123' }, 1000, 5, async () => '124', async () => false)).resolves.toBe('exited')
  })
  it('observes cancellation before waiting for a live parent', async () => {
    await expect(waitForLinuxParentExit({ pid: 23, startTime: '123' }, 1000, 5, async () => '123', async () => true)).resolves.toBe('cancelled')
  })
  it('rejects injected loader settings and malformed file input', () => {
    const request = { schema: 1, planPath: '/private/transaction/plan.json', parent: { pid: 23, startTime: '123' }, commandTimeoutMs: 1000, parentExitTimeoutMs: 1000, pollIntervalMs: 5 }
    expect(parseLinuxHelperRequest(request)).toEqual(request)
    expect(() => validateLinuxRestartEnvironment({ LD_PRELOAD: '/injected.so' })).toThrow()
    expect(() => parseLinuxHelperRequest({ ...request, restartEnvironment: { HOME: '/private/home' } })).toThrow()
    expect(() => parseLinuxHelperRequest({ ...request, planPath: '/private/../other/plan.json' })).toThrow()
    expect(() => parseLinuxHelperRequest({ ...request, parentExitTimeoutMs: 0 })).toThrow()
  })

  it.skipIf(process.platform === 'win32').each([false, true])('retains recoverable state when candidate tampering=%s', async (tampered) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-helper-files-')))
    let running: ReturnType<typeof runLinuxUpdateHelper> | undefined
    try {
      // Offline format bytes and a launch observer; no native application is executed.
      const old = Buffer.alloc(128, 1), next = Buffer.alloc(128, 2)
      for (const bytes of [old, next]) {
        Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 2]).copy(bytes)
        bytes.writeUInt16LE(62, 18)
      }
      const target = join(root, 'Desktop.AppImage'), candidate = join(root, 'DeepSeek-Harness-0.6.0-linux-x64.AppImage')
      await writeFile(target, old, { mode: 0o700 }); await writeFile(candidate, next, { mode: 0o600 })
      const plan = await prepareAppImageReplacement({ platform: 'linux', arch: 'x64', packageFormat: 'appimage', desktopVersion: '0.6.0', assetName: 'DeepSeek-Harness-0.6.0-linux-x64.AppImage', filePath: candidate, stagingDirectory: root, bytes: next.length, sha256: createHash('sha256').update(next).digest('hex') }, target)
      const requestPath = join(plan.transactionDirectory, 'helper-request.json')
      await writeLinuxUpdateRecord(requestPath, { schema: 1, planPath: join(plan.transactionDirectory, 'plan.json'), parent: { pid: 23, startTime: '123' }, commandTimeoutMs: 5000, parentExitTimeoutMs: 1000, pollIntervalMs: 5 })
      let launches = 0
      running = runLinuxUpdateHelper(requestPath, {
        move: async (source, destination) => { await link(source, destination); await unlink(source) },
        parentStartTime: async () => undefined,
        launch: async () => { launches += 1; expect(await readFile(target)).toEqual(next); return 4321 },
      })
      await expect.poll(async () => {
        try { return await readLinuxUpdateRecord(join(plan.transactionDirectory, 'ready.json')) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
      }, { timeout: 1000 }).toMatchObject({ id: plan.id, nonce: plan.nonce })
      expect(launches).toBe(0); expect(await readFile(target)).toEqual(old)
      if (tampered) await writeFile(plan.candidatePath, 'changed candidate')
      await writeLinuxUpdateRecord(join(plan.transactionDirectory, 'commit.json'), { id: plan.id, nonce: plan.nonce, command: 'commit' })
      if (tampered) {
        expect(await running).toMatchObject({ status: 'recovery-required' })
        await recoverLinuxInstall(join(plan.transactionDirectory, 'plan.json'), false)
        expect(await readFile(target)).toEqual(old); expect(launches).toBe(0)
        const second = await prepareAppImageReplacement({ platform: 'linux', arch: 'x64', packageFormat: 'appimage', desktopVersion: '0.6.0', assetName: 'DeepSeek-Harness-0.6.0-linux-x64.AppImage', filePath: candidate, stagingDirectory: root, bytes: next.length, sha256: createHash('sha256').update(next).digest('hex') }, target)
        await recoverLinuxInstall(join(second.transactionDirectory, 'plan.json'), false)
        return
      }
      expect(await running).toEqual({ status: 'restart-requested', pid: 4321 })
      expect(launches).toBe(1); expect(await readFile(plan.backupPath)).toEqual(old)
      await finishAppImageReplacement(plan)
    } finally { await running; await rm(root, { recursive: true, force: true }) }
  })
})
