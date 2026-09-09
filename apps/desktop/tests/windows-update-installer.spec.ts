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
import { bootstrapProgress, nativeUpdatePhases, observePreflightChild, preflightTempRoot, readNativePhase, settlePreflight } from './windows-update-preflight.ts'

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
  it('reports only fixed bootstrap progress frames without treating them as readiness', () => {
    expect(bootstrapProgress('DSHB:E\r\nDSHB:J\r\nDSHB:I\r\nDSHB:P\r\nDSHB:S\r\nDSHB:W\r\nDSHB:R\r\n'))
      .toEqual({ progress: ['E', 'J', 'I', 'P', 'S', 'W', 'R'], stderrAllowed: true })
    expect(bootstrapProgress('DSHB:E\nDSHB:F\n')).toEqual({ progress: ['E', 'F'], stderrAllowed: false })
    expect(bootstrapProgress('')).toEqual({ progress: [], stderrAllowed: true })
    expect(bootstrapProgress('DSHB:J\n')).toEqual({ progress: ['J'], stderrAllowed: true })
    for (const unexpected of ['DSHB:E-extra\n', 'DSHB:E\nDSHB:E\n', 'DSHB:P\nDSHB:I\n', 'private error text', 'DSHB:', 'DSHB:E']) {
      expect(bootstrapProgress(unexpected).stderrAllowed).toBe(false)
    }
    expect(isWindowsBootstrapReady('DSHB:E\nDSHB:J\nDSHB:P\n')).toBe(false)
  })
  it('retains the first preflight failure while finishing every owned cleanup in order', async () => {
    const primary = new Error('readiness failed')
    const attempted: string[] = []
    const outcome = await settlePreflight(async () => { throw primary }, [
      { code: 'cancel', run: async () => { attempted.push('cancel') } },
      { code: 'worker', run: async () => { attempted.push('worker'); throw new Error('worker cleanup failed') } },
      { code: 'bootstrap', run: async () => { attempted.push('bootstrap'); throw new Error('bootstrap cleanup failed') } },
      { code: 'parent', run: async () => { attempted.push('parent') } },
    ])
    expect(outcome.primary?.error).toBe(primary)
    expect(outcome.cleanupFailures).toEqual(['worker', 'bootstrap'])
    expect(attempted).toEqual(['cancel', 'worker', 'bootstrap', 'parent'])
  })

  it('reports cleanup failure even when the preflight itself succeeds', async () => {
    const outcome = await settlePreflight(async () => {}, [{ code: 'bootstrap', run: async () => { throw new Error('failed stop') } }])
    expect(outcome.primary).toBeUndefined()
    expect(outcome.cleanupFailures).toEqual(['bootstrap'])
  })

  it('drains only bounded byte counts and awaits the retained child close after stopping it', async () => {
    const child = spawn(process.execPath, ['-e', 'process.stdout.write("DSH_UPDATE_READY\\n"); process.stderr.write("DSHB:E\\n"+"x".repeat(5000)); setInterval(() => {}, 1000)'],
      { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { SYSTEMROOT: process.env.SYSTEMROOT } })
    const observed = observePreflightChild(child)
    try {
      await observed.waitReady()
      await expect.poll(() => observed.facts.stderrOverflow).toBe(true)
      await observed.stop()
      expect(observed.facts).toMatchObject({ spawned: true, error: false, exited: true, closed: true,
        stdoutBytes: 17, stderrBytes: 128, stdoutOverflow: false, stderrOverflow: true, progress: ['E'], stderrAllowed: false })
      expect(observed.exactReady()).toBe(true)
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
      await observed.stop()
    } finally { await observed.stop() }
  })

  it('keeps private phase identities separate from readiness and rejects incomplete or indirect records', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-native-phases-')))
    try {
      const signal = await createWindowsUpdateSignal(root)
      const record = { nonce: signal.nonce, pid: 123, started: '456', path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }
      const file = join(signal.directory, 'bootstrap-after-worker.json')
      expect(await readNativePhase(signal, 'bootstrap-after-worker')).toBeNull()
      await writeFile(file, JSON.stringify(record), { flag: 'wx', mode: 0o600 })
      expect(await readNativePhase(signal, 'bootstrap-after-worker')).toEqual({ pid: 123, started: '456', path: record.path })
      // No READY token or decision can be derived from a diagnostic record.
      await expect(readWindowsUpdateSignal(signal)).rejects.toThrow()
      for (const malformed of [JSON.stringify({ ...record, nonce: 'wrong' }), JSON.stringify({ ...record, extra: 1 }),
        JSON.stringify({ ...record, pid: 0 }), '{', 'x'.repeat(2049)]) {
        await writeFile(file, malformed)
        expect(await readNativePhase(signal, 'bootstrap-after-worker')).toBeNull()
      }
      await rm(file)
      const foreign = join(root, 'foreign.json')
      await writeFile(foreign, JSON.stringify(record), { flag: 'wx' })
      if (process.platform !== 'win32') {
        // Creating file symlinks needs an elevated token on some Windows runners; native directories remain independently guarded.
        await symlink(foreign, file)
        expect(await readNativePhase(signal, 'bootstrap-after-worker')).toBeNull()
      }
      expect(await readFile(foreign, 'utf8')).toBe(JSON.stringify(record))
    } finally { await rm(root, { recursive: true, force: true }) }
  })
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

  it('keeps a supported long installed path usable without requiring optional phase records', () => {
    const stagingDirectory = 'C:\\Users\\Fixture\\AppData\\Local\\DeepSeek Harness\\updates\\' + 'download-'.repeat(15)
    const plan = createWindowsUpdateCommand({ ...descriptor, stagingDirectory,
      localPath: stagingDirectory + '\\' + descriptor.assetName }, {
      parentPid: 123, parentExecutable: 'C:\\Users\\Fixture\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe',
      systemRoot: 'C:\\Windows', signal: { ...fixtureSignal, directory: stagingDirectory + '\\handoff-fixture' },
    })
    expect(plan.args.at(-1)!.length).toBeLessThanOrEqual(28_000)
    const script = Buffer.from(plan.args.at(-1)!, 'base64').toString('utf16le')
    expect(script).toContain("[Console]::Out.WriteLine('DSH_UPDATE_READY')")
    expect(script).toContain('Wrong worker readiness')
    expect(script).not.toContain('Write-Phase')
  })

  it('keeps native runner preflight phase observations within the command budget', () => {
    const temporary = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp'
    const root = preflightTempRoot({ RUNNER_TEMP: 'D:\\a\\_temp' }, temporary)
    const stagingDirectory = root + '\\dsh-u-ABCDEF'
    const plan = createWindowsUpdateCommand({ ...descriptor, stagingDirectory,
      localPath: stagingDirectory + '\\' + descriptor.assetName }, {
      parentPid: 12345, parentExecutable: stagingDirectory + '\\DeepSeek Harness.exe', systemRoot: 'C:\\Windows',
      signal: { ...fixtureSignal, directory: stagingDirectory + '\\handoff-ABCDEF' },
    })
    const encoded = plan.args.at(-1)!
    expect(encoded.length).toBeLessThanOrEqual(28_000)
    expect(Buffer.from(encoded, 'base64').toString('utf16le').includes('function Write-Phase')).toBe(true)
    expect(root).toBe('D:\\a\\_temp')
    expect(preflightTempRoot({}, temporary)).toBe(temporary)
    expect(preflightTempRoot({ RUNNER_TEMP: '' }, temporary)).toBe(temporary)
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
    const directory = await realpath(await mkdtemp(join(preflightTempRoot(process.env, tmpdir()), 'dsh-u-')))
    let requestedDirectory: string | undefined
    let parent: ChildProcess | undefined
    let bootstrap: ChildProcess | undefined
    let worker: { pid: number; started: string } | undefined
    let parentObservation: ReturnType<typeof observePreflightChild> | undefined
    let bootstrapObservation: ReturnType<typeof observePreflightChild> | undefined
    let phase = 'signal'
    let workerStopped = false
    let cancelled = false
    let primaryCode: string | null = null
    let phaseRecordsEnabled = false
    const publicPhases = async () => Promise.all(nativeUpdatePhases.map(async (name) => {
      const record = signal === undefined ? null : await readNativePhase(signal, name)
      return { phase: name, present: record !== null,
        bootstrapMatches: record !== null && record.pid === bootstrap?.pid,
        workerMatches: record !== null && record.pid === worker?.pid && record.started === worker?.started,
        systemPathMatches: record !== null && record.path.toLowerCase() === powershell.toLowerCase() }
    }))
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
    const outcome = await settlePreflight(async () => {
      try {
        signal = await createWindowsUpdateSignal(directory)
        // Preserve the OS tmpdir spelling check separately from the short command's working directory.
        requestedDirectory = await mkdtemp(join(tmpdir(), 'dsh-update-native-'))
        const canonicalRequestedDirectory = await realpath(requestedDirectory)
        const requestedInfo = await lstat(requestedDirectory, { bigint: true })
        const canonicalInfo = await lstat(canonicalRequestedDirectory, { bigint: true })
        const identity = { spellingChanged: requestedDirectory !== canonicalRequestedDirectory,
          sameFileId: requestedInfo.dev === canonicalInfo.dev && requestedInfo.ino === canonicalInfo.ino,
          isDirectory: requestedInfo.isDirectory(), isLink: requestedInfo.isSymbolicLink() }
        console.info('DSH_UPDATE_PATH_IDENTITY', JSON.stringify(identity))
        expect(identity).toMatchObject({ sameFileId: true, isDirectory: true, isLink: false })
        const aliasSignal = await createWindowsUpdateSignal(requestedDirectory)
        await decideWindowsUpdateSignal(aliasSignal, false)
        phase = 'parent-spawn'
        const parentExecutable = join(directory, 'DeepSeek Harness.exe')
        await copyFile(process.execPath, parentExecutable)
        parent = spawn(parentExecutable, ['-e', 'setInterval(() => {}, 1000)'], {
          shell: false, windowsHide: true, stdio: 'ignore', env: { SYSTEMROOT: systemRoot },
        })
        parentObservation = observePreflightChild(parent)
        await once(parent, 'spawn')
        phase = 'payload'
        const bytes = updatePayload('nsis')
        const localPath = join(directory, descriptor.assetName)
        await writeFile(localPath, bytes, { flag: 'wx' })
        const nativeDescriptor = { ...descriptor, localPath, stagingDirectory: directory,
          sha256: createHash('sha256').update(bytes).digest('hex') }
        const options = { parentPid: parent.pid!, parentExecutable, systemRoot, environment: process.env, signal }
        const plan = createWindowsUpdateCommand(nativeDescriptor, options)
        phaseRecordsEnabled = Buffer.from(plan.args.at(-1)!, 'base64').toString('utf16le').includes('function Write-Phase')
        phase = 'bootstrap-ready'
        bootstrap = spawn(plan.executable, plan.args, {
          detached: false, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: plan.env,
        })
        bootstrapObservation = observePreflightChild(bootstrap)
        await bootstrapObservation.waitReady()
        phase = 'worker-receipt'
        worker = await readWindowsUpdateSignal(signal)
        expect(worker.pid).not.toBe(bootstrap.pid)
        phase = 'approval'
        await decideWindowsUpdateSignal(signal, true)
        phase = 'bootstrap-close'
        await bootstrapObservation.waitClosed(20_000)
        expect(bootstrap.exitCode).toBe(0)
        expect(bootstrap.signalCode).toBeNull()
        expect(bootstrapObservation.facts.stderrAllowed).toBe(true)
        expect(bootstrapObservation.exactReady()).toBe(true)
        for (const record of await publicPhases()) {
          if (!record.present) continue
          expect(record.systemPathMatches).toBe(true)
          if (record.phase.startsWith('worker-') || record.phase === 'bootstrap-after-worker') expect(record.workerMatches).toBe(true)
          else expect(record.bootstrapMatches).toBe(true)
        }
        expect(parent.exitCode).toBeNull()
        phase = 'worker-identity'
        controlWorker(false)
        await expect(stopWindowsUpdateWorker({ ...worker, started: '1' }, systemRoot)).rejects.toThrow()
        controlWorker(false)
        await decideWindowsUpdateSignal(signal, false)
        await stopWindowsUpdateWorker(worker, systemRoot)
        await stopWindowsUpdateWorker(worker, systemRoot)
        workerStopped = true
        phase = 'wrong-hash'
        const rejectedSignal = await createWindowsUpdateSignal(directory)
        const rejected = createWindowsUpdateCommand({ ...nativeDescriptor, sha256: 'b'.repeat(64) },
          { ...options, signal: rejectedSignal })
        const bad = spawnSync(rejected.executable, rejected.args, {
          shell: false, windowsHide: true, encoding: 'utf8', timeout: 20_000, env: rejected.env,
        })
        expect(bad.error === undefined && bad.status === 1 && bad.signal === null).toBe(true)
        expect(bad.stdout).not.toContain('DSH_UPDATE_READY')
        expect(parent.exitCode).toBeNull()
        phase = 'complete'
      } catch (error) {
        // Keep the original object private; public output is only a fixed phase/code and bounded facts.
        const fixedFailure = /^(?:BOOTSTRAP_(?:READY_TIMEOUT|SPAWN_ERROR|CLOSED_BEFORE_READY|STDOUT_LIMIT)|CHILD_CLOSE_TIMEOUT)$/u
        primaryCode = error instanceof Error && fixedFailure.test(error.message)
          ? error.message : 'PREFLIGHT_ASSERTION_OR_OPERATION_FAILED'
        console.info('DSH_UPDATE_PREFLIGHT_PRIMARY', JSON.stringify({ phase, code: primaryCode, phaseRecordsEnabled,
          bootstrap: bootstrapObservation?.facts ?? null }))
        throw error
      }
    }, [
      { code: 'cancel', run: async () => {
        if (signal !== undefined) await decideWindowsUpdateSignal(signal, false)
        cancelled = true
      } },
      { code: 'worker', run: async () => {
        if (bootstrap === undefined || workerStopped) return
        if (worker === undefined && signal !== undefined) {
          const creator = await readNativePhase(signal, 'bootstrap-entered')
          const created = await readNativePhase(signal, 'bootstrap-after-worker')
          if (creator !== null && creator.pid === bootstrap.pid && created !== null && created.pid !== bootstrap.pid
            && creator.path.toLowerCase() === powershell.toLowerCase() && created.path.toLowerCase() === powershell.toLowerCase()) {
            // Cleanup only: stopWindowsUpdateWorker independently checks the exact live start time and executable.
            worker = { pid: created.pid, started: created.started }
          }
        }
        if (worker === undefined) throw new Error('WORKER_CLEANUP_UNCONFIRMED')
        await stopWindowsUpdateWorker(worker, systemRoot)
        workerStopped = true
      } },
      { code: 'bootstrap', run: async () => { await bootstrapObservation?.stop() } },
      { code: 'parent', run: async () => {
        if (bootstrap !== undefined && !cancelled && !workerStopped) throw new Error('PARENT_CLOSE_UNSAFE')
        await parentObservation?.stop()
      } },
      { code: 'alias-files', run: async () => {
        if (requestedDirectory !== undefined) await rm(requestedDirectory, { recursive: true, force: true })
      } },
    ])
    const native = await publicPhases()
    // Retain private files on unconfirmed cleanup; never publish them as artifacts.
    if (outcome.cleanupFailures.length === 0) {
      try { await rm(directory, { recursive: true, force: true }) }
      catch { outcome.cleanupFailures.push('files') }
    }
    console.info('DSH_UPDATE_PREFLIGHT_RESULT', JSON.stringify({ phase, primaryCode, phaseRecordsEnabled, primaryFailed: outcome.primary !== undefined,
      cleanupFailures: outcome.cleanupFailures, bootstrap: bootstrapObservation?.facts ?? null,
      parentClosed: parentObservation?.facts.closed ?? true, workerStopped, native }))
    if (outcome.primary !== undefined) {
      throw new Error(`Native update preflight ${primaryCode} at ${phase}; cleanup failures: ${outcome.cleanupFailures.join(',') || 'none'}.`)
    }
    expect(outcome.cleanupFailures).toEqual([])
  }, 45_000)
})
