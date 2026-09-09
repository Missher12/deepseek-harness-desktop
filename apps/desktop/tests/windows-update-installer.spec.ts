import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

function isPreflightReady(output: Buffer): boolean {
  return output.equals(Buffer.from('DSH_UPDATE_READY\r\n')) || output.equals(Buffer.from('DSH_UPDATE_READY\n'))
}

function preflightDiagnostics(output: Buffer, stdoutBytes: number, stderrBytes: number,
  child: Pick<ChildProcess, 'exitCode' | 'signalCode'>): string {
  const complete = stdoutBytes === output.length
  return JSON.stringify({
    stdoutBytes, stderrBytes, stdoutTruncated: !complete,
    utf8Ready: complete && isPreflightReady(output),
    utf16leReady: complete && (output.equals(Buffer.from('DSH_UPDATE_READY\r\n', 'utf16le'))
      || output.equals(Buffer.from('DSH_UPDATE_READY\n', 'utf16le'))),
    exitCode: child.exitCode, signal: child.signalCode,
  })
}

async function collectLaunchProbe(executable: string, args: string[], env: NodeJS.ProcessEnv,
  detached: boolean, windowsHide = true) {
  const start = () => spawn(executable, args, {
    detached, shell: false, windowsHide, stdio: ['ignore', 'pipe', 'pipe'], env,
  })
  let child: ReturnType<typeof start>
  try { child = start() } catch {
    // A synchronous OS spawn failure acquired no process or pipes.
    return { stdoutBytes: 0, stderrBytes: 0, retainedBytes: 0, entered: false, completed: false,
      timedOut: false, spawnError: true, closed: true, exitCode: null, signal: null }
  }
  let output = Buffer.alloc(0)
  let stdoutBytes = 0
  let stderrBytes = 0
  let timedOut = false
  let spawnError = false
  const onOutput = (chunk: Buffer): void => {
    stdoutBytes += chunk.length
    output = Buffer.concat([output, chunk.subarray(0, Math.max(0, 128 - output.length))])
  }
  const onStderr = (chunk: Buffer): void => { stderrBytes += chunk.length }
  const onError = (): void => { spawnError = true }
  child.stdout.on('data', onOutput)
  child.stderr.on('data', onStderr)
  child.on('error', onError)
  // These probes spawn no children. Await close, not exit, to drain both pipes.
  const closed = new Promise<void>((resolve) => { child.once('close', () => { resolve() }) })
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, 5_000)
  try {
    await closed
    const text = output.toString('utf8')
    return {
      stdoutBytes, stderrBytes, retainedBytes: output.length,
      entered: text.startsWith('DSH_PROBE_ENTER\r\n') || text.startsWith('DSH_PROBE_ENTER\n'),
      completed: text === 'DSH_PROBE_ENTER\r\nDSH_PROBE_EXIT\r\n' || text === 'DSH_PROBE_ENTER\nDSH_PROBE_EXIT\n',
      timedOut, spawnError, closed: true, exitCode: child.exitCode, signal: child.signalCode,
    }
  } finally {
    clearTimeout(timer)
    child.stdout.off('data', onOutput)
    child.stderr.off('data', onStderr)
    child.off('error', onError)
  }
}

describe('native launch probe collector', () => {
  it('drains a real process through close and recognizes both fixed script milestones', async () => {
    const result = await collectLaunchProbe(process.execPath,
      ['-e', "process.stdout.write('DSH_PROBE_ENTER\\nDSH_PROBE_EXIT\\n')"], {}, false)
    expect(result).toEqual({ stdoutBytes: 31, stderrBytes: 0, retainedBytes: 31,
      entered: true, completed: true, timedOut: false, spawnError: false,
      closed: true, exitCode: 0, signal: null })
  })

  it('bounds retained bytes and reports no unknown stdout or stderr contents', async () => {
    const result = await collectLaunchProbe(process.execPath, ['-e',
      "process.stdout.write('PRIVATE'.repeat(10000)); process.stderr.write('PRIVATE')"], {}, false)
    expect(result.stdoutBytes).toBe(70_000)
    expect(result.stderrBytes).toBe(7)
    expect(result.retainedBytes).toBeLessThanOrEqual(128)
    expect(result.entered).toBe(false)
    expect(result.completed).toBe(false)
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })

  it('kills and awaits its owned stalled process before reporting a timeout', async () => {
    const result = await collectLaunchProbe(process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'], {}, false)
    expect(result).toMatchObject({ timedOut: true, closed: true, completed: false, spawnError: false })
    expect(result.exitCode !== null || result.signal !== null).toBe(true)
  }, 10_000)

  it('settles a spawn error without exposing its executable path', async () => {
    const result = await collectLaunchProbe(join(process.execPath, 'PRIVATE_MISSING_EXECUTABLE'), [], {}, false)
    expect(result).toMatchObject({ spawnError: true, timedOut: false, closed: true,
      stdoutBytes: 0, stderrBytes: 0, entered: false, completed: false })
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })
})

describe('bounded native preflight evidence', () => {
  it('accepts only the exact production UTF-8 line, not whitespace or foreign data', () => {
    expect(isPreflightReady(Buffer.from('DSH_UPDATE_READY\r\n'))).toBe(true)
    expect(isPreflightReady(Buffer.from('DSH_UPDATE_READY\n'))).toBe(true)
    for (const output of [' DSH_UPDATE_READY\n', 'DSH_UPDATE_READY', 'DSH_UPDATE_READY\nforeign']) {
      expect(isPreflightReady(Buffer.from(output))).toBe(false)
    }
  })

  it('identifies an encoding mismatch without accepting it as readiness', () => {
    const output = Buffer.from('DSH_UPDATE_READY\r\n', 'utf16le')
    expect(isPreflightReady(output)).toBe(false)
    expect(JSON.parse(preflightDiagnostics(output, output.length, 0, { exitCode: null, signalCode: null })))
      .toMatchObject({ stdoutBytes: 36, stderrBytes: 0, utf8Ready: false, utf16leReady: true, exitCode: null })
  })

  it('reports byte counts and exit facts without leaking unknown native output', () => {
    const output = Buffer.from('PRIVATE_PROFILE_MUST_NOT_APPEAR')
    const summary = preflightDiagnostics(output, 1_000_000, 2_000_000, { exitCode: 1, signalCode: null })
    expect(summary).not.toContain('PRIVATE_PROFILE')
    expect(JSON.parse(summary)).toEqual({ stdoutBytes: 1_000_000, stderrBytes: 2_000_000,
      stdoutTruncated: true, utf8Ready: false, utf16leReady: false, exitCode: 1, signal: null })
    expect(summary.length).toBeLessThan(256)
  })
})

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

  it.skipIf(process.platform !== 'win32')('records bounded console launch contrasts without running an installer', async () => {
    const plan = createWindowsUpdateCommand(descriptor, {
      parentPid: process.pid, parentExecutable: 'C:\\Fixture\\DeepSeek Harness.exe',
      systemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows', environment: process.env,
    })
    const directory = await mkdtemp(join(tmpdir(), 'dsh-console-probe-'))
    const evidence = []
    try {
      for (const detached of [false, true]) {
        for (const windowsHide of [false, true]) {
          const sentinel = join(directory, `probe-${evidence.length}.txt`)
          const pathData = Buffer.from(sentinel).toString('base64')
          const script = `$ErrorActionPreference='Stop'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${pathData}')); [IO.File]::WriteAllText($p,'ENTER'); [Console]::Out.WriteLine('DSH_PROBE_ENTER'); [Console]::Out.Flush(); [Threading.Thread]::Sleep(250); [IO.File]::WriteAllText($p,'EXIT'); [Console]::Out.WriteLine('DSH_PROBE_EXIT'); [Console]::Out.Flush(); exit 0`
          const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
            '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
          const result = await collectLaunchProbe(plan.executable, args, plan.env, detached, windowsHide)
          const marker = await readFile(sentinel, 'utf8').catch((error: unknown) => {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
            throw new Error('Cannot inspect owned launch probe sentinel.')
          })
          evidence.push({ detached, windowsHide, ...result,
            enteredOnDisk: marker === 'ENTER' || marker === 'EXIT', completedOnDisk: marker === 'EXIT' })
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
    // Fixed labels and counts only; no command, environment, paths or native text.
    console.log('DSH_UPDATE_LAUNCH_PROBES', JSON.stringify(evidence))
    expect(evidence.every(item => item.closed && !item.spawnError)).toBe(true)
    expect(evidence[0]).toMatchObject({ entered: true, completed: true, enteredOnDisk: true,
      completedOnDisk: true, timedOut: false, exitCode: 0, signal: null })
  }, 30_000)

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
        environment: process.env,
      }
      const plan = createWindowsUpdateCommand(nativeDescriptor, options)
      // Match the production launcher's detached process and filtered environment.
      // Only stderr differs: drain/count it for diagnostics, never print its bytes.
      helper = spawn(plan.executable, plan.args, {
        detached: true, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: plan.env,
      })
      const activeHelper = helper
      await new Promise<void>((resolve, reject) => {
        let output = Buffer.alloc(0)
        let stdoutBytes = 0
        let stderrBytes = 0
        let settled = false
        const finish = (failure?: 'timeout' | 'spawn-error' | 'exit' | 'output-limit'): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          activeHelper.stdout!.off('data', onOutput)
          activeHelper.stderr!.off('data', onErrorOutput)
          activeHelper.off('error', onError)
          activeHelper.off('exit', onExit)
          if (failure === undefined) { resolve(); return }
          const evidence = preflightDiagnostics(output, stdoutBytes, stderrBytes, activeHelper)
          const parentExited = parent!.exitCode !== null || parent!.signalCode !== null
          const helperExited = activeHelper.exitCode !== null || activeHelper.signalCode !== null
          reject(new Error(`Native update preflight ${failure}; parentExited=${parentExited}; helperExited=${helperExited}; ${evidence}`))
        }
        const onOutput = (chunk: Buffer): void => {
          stdoutBytes += chunk.length
          // A strict bounded prefix is held privately for token classification;
          // unknown stdout/stderr content never enters errors or artifacts.
          output = Buffer.concat([output, chunk.subarray(0, Math.max(0, 128 - output.length))])
          if (stdoutBytes > 128) finish('output-limit')
          else if (isPreflightReady(output)) finish()
        }
        const onErrorOutput = (chunk: Buffer): void => { stderrBytes += chunk.length }
        const onError = (): void => { finish('spawn-error') }
        const onExit = (): void => { finish('exit') }
        const timer = setTimeout(() => { finish('timeout') }, 20_000)
        activeHelper.stdout!.on('data', onOutput)
        activeHelper.stderr!.on('data', onErrorOutput)
        activeHelper.once('error', onError)
        activeHelper.once('exit', onExit)
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
