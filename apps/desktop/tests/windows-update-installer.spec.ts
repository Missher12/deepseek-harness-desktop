import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { watch } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWindowsUpdateCommand, isWindowsBootstrapReady, stopWindowsUpdateWorker } from '../src/update/windows-installer.ts'
import { createWindowsUpdateSignal, decideWindowsUpdateSignal, readWindowsUpdateSignal, WindowsUpdateDecision, type WindowsUpdateSignal } from '../src/update/windows-signal.ts'
import { updatePayload } from './update-fixtures.ts'

const descriptor = {
  target: { platform: 'win32', arch: 'x64', packageFormat: 'nsis' } as const,
  desktopVersion: '0.5.8', harnessVersion: '0.1.3-alpha.1',
  assetName: 'DeepSeek-Harness-Setup-0.5.8-win-x64.exe',
  localPath: 'C:\\Users\\Fixture\\updates\\download-test\\DeepSeek-Harness-Setup-0.5.8-win-x64.exe',
  stagingDirectory: 'C:\\Users\\Fixture\\updates\\download-test', bytes: 1024, sha256: 'a'.repeat(64),
}
const fixtureSignal = { directory: descriptor.stagingDirectory + '\\handoff-fixture', nonce: 'c'.repeat(64) }

function command(environment: NodeJS.ProcessEnv = {}) {
  return createWindowsUpdateCommand(descriptor, {
    parentPid: 123, parentExecutable: 'C:\\Users\\Fixture\\App\\DeepSeek Harness.exe',
    systemRoot: 'C:\\Windows', signal: fixtureSignal, environment,
  })
}

describe('private Windows update readiness', () => {
  it('accepts an OS-resolved case alias of the same physical directory without rewriting its spelling', async (context) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-signal-alias-')))
    try {
      const physical = join(root, 'MixedCaseStage')
      const alias = join(root, 'mIXEDcASEsTAGE')
      await mkdir(physical)
      const exists = await lstat(alias).then(() => true, (error: unknown) => {
        if (process.platform !== 'win32' && error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
        throw error
      })
      if (!exists) { context.skip('This filesystem distinguishes case; Windows executes this alias regression.'); return }
      expect(await realpath(alias)).not.toBe(alias)
      const signal = await createWindowsUpdateSignal(alias)
      expect(signal.directory.startsWith(alias)).toBe(true)
      await decideWindowsUpdateSignal(signal, true)
      expect(await readFile(join(signal.directory, 'decision'), 'utf8')).toBe(signal.nonce)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects both a linked directory and a linked ancestor even when their target is owned', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-signal-link-')))
    try {
      const target = join(root, 'target')
      await mkdir(join(target, 'child'), { recursive: true })
      const alias = join(root, 'indirect')
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(createWindowsUpdateSignal(alias)).rejects.toThrow('Invalid private update signal directory')
      await expect(createWindowsUpdateSignal(join(alias, 'child'))).rejects.toThrow('Invalid private update signal directory')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('publishes a complete approval before a directory observer can open its final name', async () => {
    const stage = await realpath(await mkdtemp(join(tmpdir(), 'dsh-signal-')))
    const signal = await createWindowsUpdateSignal(stage)
    const watcher = watch(signal.directory)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const observed = new Promise<string>((resolve, reject) => {
        timer = setTimeout(() => { reject(new Error('No decision publication observed.')) }, 10_000)
        watcher.on('change', (_event, name) => {
          if (name === 'decision') void readFile(join(signal.directory, 'decision'), 'utf8').then(resolve, reject)
        })
        watcher.once('error', reject)
      })
      await decideWindowsUpdateSignal(signal, true)
      expect(await observed).toBe(signal.nonce)
    } finally {
      clearTimeout(timer)
      const closed = once(watcher, 'close')
      watcher.close()
      await closed
      await rm(stage, { recursive: true, force: true })
    }
  }, 15_000)

  it('allocates distinct physical rendezvous and consumes only the exact nonce/worker receipt', async () => {
    const stage = await realpath(await mkdtemp(join(tmpdir(), 'dsh-signal-')))
    try {
      const signal = await createWindowsUpdateSignal(stage)
      const other = await createWindowsUpdateSignal(stage)
      expect(signal.directory).not.toBe(other.directory)
      expect(signal.nonce).not.toBe(other.nonce)
      const record = { schema: 1, nonce: signal.nonce, token: 'DSH_UPDATE_READY', pid: 123, started: '123456789' }
      await writeFile(join(signal.directory, 'ready.json'), JSON.stringify(record), { flag: 'wx' })
      expect(await readWindowsUpdateSignal(signal)).toEqual({ pid: 123, started: '123456789' })
      for (const changed of [{ nonce: other.nonce }, { token: 'DSH_UPDATE_READY extra' },
        { pid: 0 }, { pid: '123' }, { started: '-1' }, { extra: true }, { schema: 2 }]) {
        await writeFile(join(signal.directory, 'ready.json'), JSON.stringify({ ...record, ...changed }))
        await expect(readWindowsUpdateSignal(signal)).rejects.toThrow()
      }
      await decideWindowsUpdateSignal(signal, true)
      expect(await readFile(join(signal.directory, 'decision'), 'utf8')).toBe(signal.nonce)
      await expect(decideWindowsUpdateSignal(signal, true)).rejects.toThrow()
      await decideWindowsUpdateSignal(signal, false)
      expect(await readFile(join(signal.directory, 'cancelled'), 'utf8')).toBe('CANCEL')
      await expect(decideWindowsUpdateSignal(signal, true)).rejects.toThrow()
    } finally { await rm(stage, { recursive: true, force: true }) }
  })

  it('rejects oversized and linked readiness without reading or changing a foreign file', async () => {
    const stage = await realpath(await mkdtemp(join(tmpdir(), 'dsh-signal-')))
    try {
      const signal = await createWindowsUpdateSignal(stage)
      const path = join(signal.directory, 'ready.json')
      await writeFile(path, 'x'.repeat(1025))
      await expect(readWindowsUpdateSignal(signal)).rejects.toThrow()
      await rm(path)
      const foreign = join(stage, 'foreign')
      await writeFile(foreign, 'PROTECTED')
      await symlink(foreign, path, 'file')
      await expect(readWindowsUpdateSignal(signal)).rejects.toThrow()
      await symlink(foreign, join(signal.directory, 'cancelled'), 'file')
      await expect(decideWindowsUpdateSignal(signal, false)).rejects.toThrow()
      expect(await readFile(foreign, 'utf8')).toBe('PROTECTED')
    } finally { await rm(stage, { recursive: true, force: true }) }
  })

  it('never approves a receipt that finishes reading after cancellation', async () => {
    const stage = await realpath(await mkdtemp(join(tmpdir(), 'dsh-signal-')))
    try {
      const signal = await createWindowsUpdateSignal(stage)
      let release: () => void = () => {}
      const barrier = new Promise<void>((resolve) => { release = resolve })
      const decision = new WindowsUpdateDecision(signal, async () => {
        await barrier
        return { pid: 123, started: '123456789' }
      })
      const approving = decision.approve()
      await decision.cancel()
      release()
      await expect(approving).rejects.toThrow('cancelled')
      await expect(readFile(join(signal.directory, 'decision'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(join(signal.directory, 'cancelled'), 'utf8')).toBe('CANCEL')
    } finally { await rm(stage, { recursive: true, force: true }) }
  })

  it('keeps cancellation dominant when approval publication is already queued', async () => {
    const stage = await realpath(await mkdtemp(join(tmpdir(), 'dsh-signal-')))
    try {
      const signal = await createWindowsUpdateSignal(stage)
      const decision = new WindowsUpdateDecision(signal, async () => ({ pid: 123, started: '123456789' }))
      const approval = decision.approve()
      await Promise.resolve()
      const cancellation = decision.cancel()
      await Promise.allSettled([approval, cancellation])
      expect(await readFile(join(signal.directory, 'cancelled'), 'utf8')).toBe('CANCEL')
      await expect(decision.approve()).rejects.toThrow('cancelled')
    } finally { await rm(stage, { recursive: true, force: true }) }
  })
})

describe('Windows update bootstrap and independent worker', () => {
  it('rejects even short trailing output after an otherwise exact READY line', () => {
    expect(isWindowsBootstrapReady('DSH_UPDATE_READY\r\n')).toBe(true)
    expect(isWindowsBootstrapReady('DSH_UPDATE_READY\n')).toBe(true)
    for (const output of ['DSH_UPDATE_READY\nextra', 'DSH_UPDATE_READY\r\n ', ' DSH_UPDATE_READY\n', 'DSH_UPDATE_READY']) {
      expect(isWindowsBootstrapReady(output)).toBe(false)
    }
  })
  it('uses a short system bootstrap with an owned worker handle and visible Setup only after verified parent exit', () => {
    const plan = command()
    expect(plan.executable).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(plan.args.slice(0, -1)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand'])
    const script = Buffer.from(plan.args.at(-1)!, 'base64').toString('utf16le')
    expect(script).toContain('$worker = Start-Process -FilePath $systemPowerShell')
    expect(script).toContain('$worker.Handle')
    expect(script).toContain('[IO.FileMode]::CreateNew')
    expect(script).toContain('$record.pid -ne $worker.Id')
    expect(script).toContain('$record.started -cne $started')
    expect(script).toContain('$record.nonce -cne $config.nonce')
    expect(script).toContain('$parent.WaitForExit(100)')
    expect(script).toContain('$parentDeadline = [DateTime]::UtcNow.AddSeconds(120)')
    const waiting = script.slice(script.indexOf('$parentDeadline'), script.indexOf('$parent.Dispose()'))
    expect(waiting).toContain("'cancelled'")
    expect(script).toContain('Unapproved handoff')
    expect(script).toContain('ReparsePoint')
    expect(script).toContain('ComputeHash')
    expect(script).toContain('-WindowStyle Normal -PassThru')
    expect(script.indexOf('$parent.WaitForExit(100)')).toBeLessThan(script.indexOf('Start-Process'))
    expect(script).not.toMatch(/\/S\b|Stop-Process|Remove-Item|Invoke-Expression|ELECTRON_RUN_AS_NODE|conhost/u)
    expect(Object.keys(plan.env).sort()).toEqual(['SYSTEMROOT', 'WINDIR'])
    expect(plan.args.at(-1)!.length).toBeLessThanOrEqual(28_000)
  })

  it('rejects foreign payloads, non-system executables and signal paths outside the private stage', () => {
    const options = { parentPid: 123, parentExecutable: 'C:\\App\\DeepSeek Harness.exe',
      systemRoot: 'C:\\Windows', signal: fixtureSignal }
    expect(() => createWindowsUpdateCommand({ ...descriptor, target: { platform: 'linux', arch: 'x64', packageFormat: 'deb' } }, options)).toThrow()
    expect(() => createWindowsUpdateCommand(descriptor, { ...options, systemRoot: 'C:\\Temp\\helper' })).toThrow()
    expect(() => createWindowsUpdateCommand(descriptor, { ...options, parentPid: 0 })).toThrow()
    expect(() => createWindowsUpdateCommand(descriptor, { ...options, signal: { ...fixtureSignal, directory: 'C:\\other' } })).toThrow()
    expect(() => createWindowsUpdateCommand(descriptor, { ...options, signal: { ...fixtureSignal, nonce: 'wrong' } })).toThrow()
  })

  it.skipIf(process.platform !== 'win32')('parses both the real bootstrap and nested worker with Windows PowerShell', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-update-parser-')))
    const plan = command(process.env)
    const source = Buffer.from(plan.args.at(-1)!, 'base64').toString('utf16le')
    const marker = "$workerScript = @'\n"
    const start = source.indexOf(marker) + marker.length
    const worker = source.slice(start, source.indexOf("\n'@", start))
    const parser = `
$ErrorActionPreference='Stop'
$failed=$false
foreach($name in @('bootstrap.ps1','worker.ps1')) {
  $tokens=$null; $errors=$null
  [void][System.Management.Automation.Language.Parser]::ParseFile([IO.Path]::Combine($env:DSH_PARSER_ROOT,$name),[ref]$tokens,[ref]$errors)
  [Console]::Out.WriteLine(('DSH_PARSE {0} {1}' -f $name,@($errors).Count))
  if(@($errors).Count -gt 0){$failed=$true}
}
if($failed){exit 1}
`
    const parse = () => {
      const result = spawnSync(plan.executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(parser, 'utf16le').toString('base64')], {
        stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: false, windowsHide: true,
        timeout: 10_000, maxBuffer: 1024, env: { ...plan.env, DSH_PARSER_ROOT: directory },
      })
      const lines = result.stdout?.trim().split(/\r?\n/u) ?? []
      return { status: result.status, signal: result.signal,
        errorCode: result.error === undefined ? null
          : 'code' in result.error && typeof result.error.code === 'string' ? result.error.code : 'UNKNOWN',
        counts: lines.map(line => /^DSH_PARSE (bootstrap|worker)\.ps1 (\d+)$/u.exec(line)?.slice(1) ?? ['invalid']),
        stderrBytes: Buffer.byteLength(result.stderr ?? '') }
    }
    try {
      await writeFile(join(directory, 'bootstrap.ps1'), source, { flag: 'wx', mode: 0o600 })
      await writeFile(join(directory, 'worker.ps1'), worker, { flag: 'wx', mode: 0o600 })
      expect(parse()).toEqual({ status: 0, signal: null, errorCode: null,
        counts: [['bootstrap', '0'], ['worker', '0']], stderrBytes: 0 })
      await writeFile(join(directory, 'worker.ps1'), ')')
      const rejected = parse()
      expect(rejected).toMatchObject({ status: 1, signal: null, errorCode: null, stderrBytes: 0 })
      expect(rejected.counts[0]).toEqual(['bootstrap', '0'])
      expect(rejected.counts[1]?.[0]).toBe('worker')
      expect(Number(rejected.counts[1]?.[1])).toBeGreaterThan(0)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it.skipIf(process.platform !== 'win32')('validates the real payload, survives bootstrap exit and cancels the exact worker without running the inert Setup', async () => {
    const requestedDirectory = await mkdtemp(join(tmpdir(), 'dsh-update-native-'))
    const directory = await realpath(requestedDirectory)
    let parent: ChildProcess | undefined
    let bootstrap: ChildProcess | undefined
    let worker: { pid: number; started: string } | undefined
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows'
    const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    let signal: WindowsUpdateSignal | undefined
    const controlWorker = (terminate: boolean): void => {
      if (worker === undefined) return
      const source = '$ErrorActionPreference=\"Stop\"; try {$p=[Diagnostics.Process]::GetProcessById(' + String(worker.pid)
        + '); [void]$p.Handle; if($p.StartTime.ToUniversalTime().Ticks.ToString() -cne \"' + worker.started
        + '\" -or $p.MainModule.FileName -ine [IO.Path]::Combine($env:SYSTEMROOT,\"System32\",\"WindowsPowerShell\",\"v1.0\",\"powershell.exe\")){exit 2}; '
        + (terminate ? '$p.Kill(); if(!$p.WaitForExit(5000)){exit 3}; ' : 'if($p.HasExited){exit 4}; ')
        + '$p.Dispose(); exit 0} catch {exit 1}'
      const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', source], {
        shell: false, windowsHide: true, encoding: 'utf8', timeout: 10_000, env: { SYSTEMROOT: systemRoot, WINDIR: systemRoot },
      })
      expect(result.error === undefined && result.status === 0 && result.signal === null).toBe(true)
    }
    const stop = async (child: ChildProcess | undefined): Promise<void> => {
      if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
      const closed = once(child, 'close')
      child.kill()
      await closed
    }
    try {
      signal = await createWindowsUpdateSignal(directory)
      const requestedInfo = await lstat(requestedDirectory, { bigint: true })
      const canonicalInfo = await lstat(directory, { bigint: true })
      const identity = { spellingChanged: requestedDirectory !== directory,
        sameFileId: requestedInfo.dev === canonicalInfo.dev && requestedInfo.ino === canonicalInfo.ino,
        isDirectory: requestedInfo.isDirectory(), isLink: requestedInfo.isSymbolicLink() }
      console.info('DSH_UPDATE_PATH_IDENTITY', JSON.stringify(identity))
      expect(identity).toMatchObject({ sameFileId: true, isDirectory: true, isLink: false })
      const aliasSignal = await createWindowsUpdateSignal(requestedDirectory)
      await decideWindowsUpdateSignal(aliasSignal, false)
      const parentExecutable = join(directory, 'DeepSeek Harness.exe')
      await copyFile(process.execPath, parentExecutable)
      parent = spawn(parentExecutable, ['-e', 'setInterval(() => {}, 1000)'], {
        shell: false, windowsHide: true, stdio: 'ignore', env: { SYSTEMROOT: systemRoot },
      })
      await once(parent, 'spawn')
      const bytes = updatePayload('nsis')
      const localPath = join(directory, descriptor.assetName)
      await writeFile(localPath, bytes, { flag: 'wx' })
      const nativeDescriptor = { ...descriptor, localPath, stagingDirectory: directory,
        sha256: createHash('sha256').update(bytes).digest('hex') }
      const options = { parentPid: parent.pid!, parentExecutable, systemRoot, environment: process.env, signal }
      const plan = createWindowsUpdateCommand(nativeDescriptor, options)
      bootstrap = spawn(plan.executable, plan.args, {
        detached: false, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: plan.env,
      })
      const active = bootstrap
      let output = ''
      let stderrBytes = 0
      active.stderr!.on('data', (chunk: Buffer) => { stderrBytes += chunk.length })
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('Native bootstrap readiness timeout.')) }, 20_000)
        active.once('error', () => { clearTimeout(timer); reject(new Error('Native bootstrap spawn failed.')) })
        active.once('close', () => {
          clearTimeout(timer)
          if (output !== 'DSH_UPDATE_READY\r\n' && output !== 'DSH_UPDATE_READY\n') reject(new Error('Native bootstrap closed without readiness.'))
        })
        active.stdout!.on('data', (chunk: Buffer) => {
          if (output.length + chunk.length > 128) { clearTimeout(timer); reject(new Error('Native bootstrap output limit.')); return }
          output += chunk.toString('utf8')
          if (output === 'DSH_UPDATE_READY\r\n' || output === 'DSH_UPDATE_READY\n') { clearTimeout(timer); resolve() }
        })
      })
      worker = await readWindowsUpdateSignal(signal)
      expect(worker.pid).not.toBe(bootstrap.pid)
      await decideWindowsUpdateSignal(signal, true)
      await expect.poll(() => bootstrap!.exitCode, { timeout: 20_000 }).toBe(0)
      expect(bootstrap.signalCode).toBeNull()
      expect(stderrBytes).toBe(0)
      expect(output === 'DSH_UPDATE_READY\r\n' || output === 'DSH_UPDATE_READY\n').toBe(true)
      expect(parent.exitCode).toBeNull()
      controlWorker(false)
      await expect(stopWindowsUpdateWorker({ ...worker, started: '1' }, systemRoot)).rejects.toThrow()
      controlWorker(false)
      await decideWindowsUpdateSignal(signal, false)
      await stopWindowsUpdateWorker(worker, systemRoot)
      await stopWindowsUpdateWorker(worker, systemRoot)
      worker = undefined
      const rejectedSignal = await createWindowsUpdateSignal(directory)
      const rejected = createWindowsUpdateCommand({ ...nativeDescriptor, sha256: 'b'.repeat(64) },
        { ...options, signal: rejectedSignal })
      const bad = spawnSync(rejected.executable, rejected.args, {
        shell: false, windowsHide: true, encoding: 'utf8', timeout: 20_000, env: rejected.env,
      })
      expect(bad.error === undefined && bad.status === 1 && bad.signal === null).toBe(true)
      expect(bad.stdout).not.toContain('DSH_UPDATE_READY')
      expect(parent.exitCode).toBeNull()
    } finally {
      if (signal !== undefined) await decideWindowsUpdateSignal(signal, false)
      if (bootstrap !== undefined && bootstrap.exitCode === null && bootstrap.signalCode === null) {
        await expect.poll(() => bootstrap!.exitCode !== null || bootstrap!.signalCode !== null, { timeout: 20_000 }).toBe(true)
      }
      if (worker !== undefined) await stopWindowsUpdateWorker(worker, systemRoot)
      await stop(parent)
      await rm(directory, { recursive: true, force: true })
    }
  }, 45_000)
})
