import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWindowsUpdateCommand } from '../src/update/windows-installer.ts'
import { updatePayload } from './update-fixtures.ts'

const descriptor = {
  target: { platform: 'win32', arch: 'x64', packageFormat: 'nsis' } as const,
  desktopVersion: '0.5.8', harnessVersion: '0.1.3-alpha.1',
  assetName: 'DeepSeek-Harness-Setup-0.5.8-win-x64.exe',
  localPath: 'C:\\Users\\Fixture\\updates\\download-test\\DeepSeek-Harness-Setup-0.5.8-win-x64.exe',
  stagingDirectory: 'C:\\Users\\Fixture\\updates\\download-test', bytes: 1024, sha256: 'a'.repeat(64),
}

function command() {
  return createWindowsUpdateCommand(descriptor, {
    parentPid: 123, parentExecutable: 'C:\\Users\\Fixture\\App\\DeepSeek Harness.exe',
    systemRoot: 'C:\\Windows',
  })
}

describe('Windows update handoff command', () => {
  it('uses a fixed independent system helper and a visible Setup only after parent exit and revalidation', () => {
    const plan = command()
    expect(plan.executable).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(plan.args.slice(0, -1)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand'])
    const script = Buffer.from(plan.args.at(-1)!, 'base64').toString('utf16le')
    expect(script).toContain('DSH_UPDATE_READY')
    expect(script).toContain('$parent.WaitForExit(120000)')
    expect(script).toContain('ReparsePoint')
    expect(script).toContain('ComputeHash')
    expect(script).toContain('-WindowStyle Normal -PassThru')
    expect(script.indexOf('$parent.WaitForExit(120000)')).toBeLessThan(script.indexOf('Start-Process'))
    expect(script).not.toMatch(/-ArgumentList|\/S\b|Stop-Process|Remove-Item|Invoke-Expression|ELECTRON_RUN_AS_NODE/)
    expect(Object.keys(plan.env).sort()).toEqual(['SYSTEMROOT', 'WINDIR'])
  })

  it('rejects foreign formats and a non-system helper directory before preparing a command', () => {
    const options = { parentPid: 123, parentExecutable: 'C:\\App\\DeepSeek Harness.exe', systemRoot: 'C:\\Windows' }
    expect(() => createWindowsUpdateCommand({ ...descriptor, target: { platform: 'linux', arch: 'x64', packageFormat: 'deb' } }, options)).toThrow()
    expect(() => createWindowsUpdateCommand(descriptor, { ...options, systemRoot: 'C:\\Temp\\helper' })).toThrow()
    expect(() => createWindowsUpdateCommand(descriptor, { ...options, parentPid: 0 })).toThrow()
  })

  it.skipIf(process.platform !== 'win32')('parses the actual encoded helper with native Windows PowerShell without executing it', () => {
    const plan = command()
    const script = Buffer.from(plan.args.at(-1)!, 'base64').toString('utf16le')
    const parser = '$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(),[ref]$tokens,[ref]$errors); if($errors.Count){exit 1}'
    const result = spawnSync(plan.executable, ['-NoProfile', '-NonInteractive', '-Command', parser], {
      input: script, encoding: 'utf8', shell: false, timeout: 10_000,
      env: { SYSTEMROOT: process.env.SYSTEMROOT ?? process.env.SystemRoot, WINDIR: process.env.WINDIR },
    })
    expect(result.status).toBe(0)
    expect(result.signal).toBeNull()
  })

  it.skipIf(process.platform !== 'win32')('natively validates the retained payload and waits for its exact parent without launching an installer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-update-native-'))
    let parent: ChildProcess | undefined
    let helper: ChildProcess | undefined
    const stop = async (child: ChildProcess | undefined): Promise<void> => {
      if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
      const closed = once(child, 'close')
      child.kill()
      await closed
    }
    try {
      const parentExecutable = join(directory, 'DeepSeek Harness.exe')
      await copyFile(process.execPath, parentExecutable)
      parent = spawn(parentExecutable, ['-e', 'setInterval(() => {}, 1000)'], {
        shell: false, windowsHide: true, stdio: 'ignore',
        env: { SYSTEMROOT: process.env.SystemRoot ?? process.env.SYSTEMROOT },
      })
      await once(parent, 'spawn')
      expect(parent.pid).toBeTypeOf('number')
      const bytes = updatePayload('nsis')
      const localPath = join(directory, descriptor.assetName)
      await writeFile(localPath, bytes, { flag: 'wx' })
      const nativeDescriptor = { ...descriptor, localPath, stagingDirectory: directory,
        sha256: createHash('sha256').update(bytes).digest('hex') }
      const options = {
        parentPid: parent.pid!, parentExecutable,
        systemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows',
      }
      const plan = createWindowsUpdateCommand(nativeDescriptor, options)
      helper = spawn(plan.executable, plan.args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: plan.env })
      const activeHelper = helper
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('Native update preflight did not acknowledge.')) }, 20_000)
        let output = ''
        activeHelper.stdout!.setEncoding('utf8')
        activeHelper.stdout!.on('data', (chunk: string) => {
          output += chunk
          if (output.trim() === 'DSH_UPDATE_READY') { clearTimeout(timer); resolve() }
        })
        activeHelper.once('error', () => { clearTimeout(timer); reject(new Error('Native helper failed.')) })
        activeHelper.once('exit', () => { clearTimeout(timer); reject(new Error('Native helper exited before handoff.')) })
      })
      expect(parent.exitCode).toBeNull()
      expect(helper.exitCode).toBeNull()
      // Terminate only the owned waiting helper before closing its inert parent:
      // the format-shaped bytes are never executed or called a native Setup.
      await stop(helper)
      helper = undefined
      const rejected = createWindowsUpdateCommand({ ...nativeDescriptor, sha256: 'b'.repeat(64) }, options)
      const bad = spawnSync(rejected.executable, rejected.args, {
        shell: false, windowsHide: true, encoding: 'utf8', timeout: 20_000, env: rejected.env,
      })
      expect(bad.status).toBe(1)
      expect(bad.stdout).not.toContain('DSH_UPDATE_READY')
      expect(parent.exitCode).toBeNull()
    } finally {
      await stop(helper)
      await stop(parent)
      await rm(directory, { recursive: true, force: true })
    }
  }, 45_000)
})
