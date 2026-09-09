/** Fixed Windows PowerShell bootstrap, independent worker and verified installer handoff. */
import { execFile, spawn } from 'node:child_process'
import { win32 } from 'node:path'
import { promisify } from 'node:util'
import { validateDesktopUpdateManifest, type VerifiedDesktopUpdate } from './release.ts'
import { verifyDesktopUpdateFile } from './verification.ts'
import { createWindowsUpdateSignal, readWindowsUpdateSignal, WindowsUpdateDecision, type WindowsUpdateSignal, type WindowsUpdateWorker } from './windows-signal.ts'

const execFileAsync = promisify(execFile)

/**
 * Stop only the verified worker through a retained kernel handle; an absent worker is already stopped.
 * @param worker Exact PID and creation ticks from the verified bootstrap receipt.
 * @param systemRoot Fixed Windows system directory used to create the worker.
 * @returns Resolves after exit; rejects identity mismatch or incomplete cleanup.
 */
export async function stopWindowsUpdateWorker(worker: WindowsUpdateWorker, systemRoot: string): Promise<void> {
  if (!/^[a-z]:\\Windows$/i.test(systemRoot)) throw new Error('Invalid system directory.')
  const executable = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const data = Buffer.from(JSON.stringify(worker)).toString('base64')
  const source = `
$ErrorActionPreference = 'Stop'
try {
  $r = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
  try { $p = [Diagnostics.Process]::GetProcessById($r.pid) }
  catch [ArgumentException] { exit 0 }
  try {
    [void]$p.Handle
    if ($p.HasExited) { exit 0 }
    if ($p.StartTime.ToUniversalTime().Ticks.ToString() -cne $r.started -or $p.MainModule.FileName -ine [IO.Path]::Combine($env:SYSTEMROOT,'System32','WindowsPowerShell','v1.0','powershell.exe')) { throw 'Worker identity changed' }
    if (!$p.HasExited) { $p.Kill() }
    if (!$p.WaitForExit(5000)) { throw 'Worker cleanup incomplete' }
  } catch { if (!$p.HasExited) { throw } }
  finally { $p.Dispose() }
} catch { exit 1 }
`
  await execFileAsync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(source, 'utf16le').toString('base64')], {
    shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 1024,
    env: { SYSTEMROOT: systemRoot, WINDIR: systemRoot },
  })
}

interface WindowsUpdateCommandOptions {
  parentPid: number
  parentExecutable: string
  systemRoot: string
  environment?: NodeJS.ProcessEnv
  signal: WindowsUpdateSignal
}

/**
 * The whole bootstrap stream must be one exact readiness line, including at close.
 * @param output Complete bounded bootstrap stdout.
 * @returns Whether the output contains exactly the fixed readiness line.
 */
export function isWindowsBootstrapReady(output: string): boolean {
  return output === 'DSH_UPDATE_READY\r\n' || output === 'DSH_UPDATE_READY\n'
}

/**
 * Prepare a short bootstrap and an independent worker without holding the installed EXE open during replacement.
 * @param descriptor Verified native Setup and its owned staging directory.
 * @param options Native parent identity, system directory and private transaction.
 * @returns Fixed system executable, encoded arguments and allowlisted environment.
 */
export function createWindowsUpdateCommand(descriptor: VerifiedDesktopUpdate, options: WindowsUpdateCommandOptions): {
  executable: string
  args: string[]
  env: NodeJS.ProcessEnv
} {
  if (descriptor.target.platform !== 'win32'
    || !Number.isSafeInteger(options.parentPid) || options.parentPid <= 0
    || !/^[a-z]:\\Windows$/i.test(options.systemRoot)
    || !/^[a-z]:\\/i.test(options.parentExecutable)
    || win32.basename(options.parentExecutable) !== 'DeepSeek Harness.exe'
    || !/^[a-z]:\\/i.test(descriptor.localPath)
    || win32.dirname(descriptor.localPath) !== descriptor.stagingDirectory
    || win32.basename(descriptor.localPath) !== descriptor.assetName
    || win32.dirname(options.signal.directory) !== descriptor.stagingDirectory
    || !/^handoff-[a-z0-9]+$/i.test(win32.basename(options.signal.directory))
    || !/^[a-f0-9]{64}$/.test(options.signal.nonce)
    || validateDesktopUpdateManifest({
      schema: 2, ...descriptor.target, desktopVersion: descriptor.desktopVersion, harnessVersion: descriptor.harnessVersion,
      assetName: descriptor.assetName, bytes: descriptor.bytes, sha256: descriptor.sha256,
      releaseUrl: `https://github.com/Missher12/deepseek-harness-desktop/releases/tag/desktop-v${descriptor.desktopVersion}`,
    }, descriptor.target) === null) throw new Error('Invalid Windows update handoff.')
  const config = Buffer.from(JSON.stringify({
    parentPid: options.parentPid, parentExecutable: options.parentExecutable,
    path: descriptor.localPath, stage: descriptor.stagingDirectory,
    name: descriptor.assetName, bytes: descriptor.bytes, sha256: descriptor.sha256,
    signal: options.signal.directory, nonce: options.signal.nonce,
  })).toString('base64')
  const phaseCalls: string[] = []
  const observe = (name: string, processName = 'self'): string => {
    const call = `Write-Phase '${name}' $${processName};`
    phaseCalls.push(call)
    return call
  }
  // Best-effort private phase records never participate in readiness or approval.
  const phases = `
function Write-Phase($n,$p) {
  try {
    $d=[IO.DirectoryInfo]::new($config.signal)
    if(!$d.Exists -or ($d.Attributes -band [IO.FileAttributes]::ReparsePoint)){return}
    $b=[Text.Encoding]::UTF8.GetBytes((@{nonce=$config.nonce;pid=$p.Id;started=$p.StartTime.ToUniversalTime().Ticks.ToString();path=$p.MainModule.FileName}|ConvertTo-Json -Compress))
    $f=[IO.File]::Open([IO.Path]::Combine($d.FullName,$n+'.json'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$f.Write($b,0,$b.Length)}finally{$f.Dispose()}
  } catch { } # Diagnostic failure must not change the handoff result.
}
`
  // Only base64 data is substituted. No renderer-supplied script, command or arguments.
  const workerScript = `
$ErrorActionPreference = 'Stop'
${phases}
try {
  $config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${config}')) | ConvertFrom-Json
  $self = [Diagnostics.Process]::GetCurrentProcess()
  ${observe('worker-entered')}
  function Open-VerifiedPayload {
    $fileInfo = [IO.FileInfo]::new($config.path)
    $stageInfo = [IO.DirectoryInfo]::new($config.stage)
    if (($fileInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($stageInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked update' }
    if (!$fileInfo.Exists -or !$stageInfo.Exists -or $fileInfo.Name -cne $config.name -or $fileInfo.DirectoryName -ine $stageInfo.FullName) { throw 'Invalid update path' }
    $file = [IO.File]::Open($fileInfo.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
      if ($file.Length -ne $config.bytes) { throw 'Wrong update size' }
      $header = [byte[]]::new([Math]::Min(1048576, $file.Length))
      $offset = 0
      while ($offset -lt $header.Length) {
        $read = $file.Read($header, $offset, $header.Length - $offset)
        if ($read -eq 0) { throw 'Truncated update' }
        $offset += $read
      }
      if ($header.Length -lt 64 -or $header[0] -ne 77 -or $header[1] -ne 90) { throw 'Not a PE executable' }
      $pe = [BitConverter]::ToUInt32($header, 60)
      if ($pe -lt 64 -or $pe + 26 -gt $header.Length -or [BitConverter]::ToUInt32($header, $pe) -ne 17744) { throw 'Invalid PE header' }
      if ([BitConverter]::ToUInt16($header, $pe + 4) -notin @(332,34404) -or [BitConverter]::ToUInt16($header, $pe + 24) -notin @(267,523)) { throw 'Unsupported PE header' }
      $file.Position = 0
      $hash = [Security.Cryptography.SHA256]::Create()
      try { $digest = [BitConverter]::ToString($hash.ComputeHash($file)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
      if ($digest -cne $config.sha256) { throw 'Wrong update checksum' }
      return $file
    } catch { $file.Dispose(); throw }
  }
  $parent = [Diagnostics.Process]::GetProcessById($config.parentPid)
  [void]$parent.Handle
  if ($parent.MainModule.FileName -ine $config.parentExecutable) { throw 'Wrong parent process' }
  ${observe('worker-parent')}
  $preflight = Open-VerifiedPayload
  $preflight.Dispose()
  ${observe('worker-payload')}
  $signal = [IO.DirectoryInfo]::new($config.signal)
  if (!$signal.Exists -or ($signal.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid signal directory' }
  $record = @{schema=1;nonce=$config.nonce;token='DSH_UPDATE_READY';pid=$PID;started=$self.StartTime.ToUniversalTime().Ticks.ToString()} | ConvertTo-Json -Compress
  $ready = [IO.File]::Open([IO.Path]::Combine($config.signal,'ready.json'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($record)
    $ready.Write($bytes,0,$bytes.Length); $ready.Flush()
  } finally { $ready.Dispose() }
  ${observe('worker-ready')}
  $parentDeadline = [DateTime]::UtcNow.AddSeconds(120)
  while (!$parent.WaitForExit(100)) {
    if ([IO.File]::Exists([IO.Path]::Combine($config.signal,'cancelled'))) { throw 'Cancelled handoff' }
    if ([DateTime]::UtcNow -ge $parentDeadline) { throw 'Application did not exit' }
  }
  $parent.Dispose()
  if ([IO.File]::Exists([IO.Path]::Combine($config.signal,'cancelled'))) { throw 'Cancelled handoff' }
  $decision = [IO.FileInfo]::new([IO.Path]::Combine($config.signal,'decision'))
  if (!$decision.Exists -or ($decision.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $decision.Length -ne 64 -or [IO.File]::ReadAllText($decision.FullName) -cne $config.nonce) { throw 'Unapproved handoff' }
  ${observe('worker-decision')}
  $lockedPayload = Open-VerifiedPayload
  try {
    $setup = Start-Process -FilePath $config.path -WorkingDirectory $config.stage -WindowStyle Normal -PassThru
    if (!$setup.Id) { throw 'Setup did not start' }
    $setup.Dispose()
  } finally { $lockedPayload.Dispose() }
} catch { ${observe('worker-failed')} exit 1 }
finally { ${observe('worker-finally')} if($null -ne $self){$self.Dispose()} }
`
  // E/J bracket JSON; J/I acquire self, I/P bracket the property-reading phase;
  // S/W bracket native spawn, R confirms worker identity, F reports a caught failure.
  const script = `
function Trace($c){try{[Console]::Error.WriteLine('DSHB:'+$c);[Console]::Error.Flush()}catch{}}
Trace 'E'
$ErrorActionPreference = 'Stop'
$worker = $null
$approved = $false
${phases}
$workerScript = @'
${workerScript}
'@
try {
  $config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${config}')) | ConvertFrom-Json
  Trace 'J'
  $self = [Diagnostics.Process]::GetCurrentProcess()
  Trace 'I'
  ${observe('bootstrap-entered')}
  Trace 'P'
  $signal = [IO.DirectoryInfo]::new($config.signal)
  if (!$signal.Exists -or ($signal.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid signal directory' }
  $systemPowerShell = [IO.Path]::Combine($env:SYSTEMROOT,'System32','WindowsPowerShell','v1.0','powershell.exe')
  $workerArguments = @('-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($workerScript)))
  ${observe('bootstrap-before-worker')}
  Trace 'S'
  $worker = Start-Process -FilePath $systemPowerShell -ArgumentList $workerArguments -WindowStyle Hidden -PassThru
  Trace 'W'
  [void]$worker.Handle
  $started = $worker.StartTime.ToUniversalTime().Ticks.ToString()
  if ($worker.MainModule.FileName -ine $systemPowerShell) { throw 'Wrong worker executable' }
  Trace 'R'
  ${observe('bootstrap-after-worker', 'worker')}
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  $readyPath = [IO.Path]::Combine($config.signal,'ready.json')
  $acknowledged = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    if ([IO.File]::Exists([IO.Path]::Combine($config.signal,'cancelled'))) { throw 'Handoff cancelled' }
    if ($worker.HasExited) { throw 'Worker exited before handoff' }
    if (!$acknowledged -and [IO.File]::Exists($readyPath)) {
      $info = [IO.FileInfo]::new($readyPath)
      if (($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $info.Length -gt 1024) { throw 'Invalid readiness file' }
      $ready = $null
      try { $ready = [IO.File]::Open($readyPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read) }
      catch [IO.IOException] { if (($_.Exception.HResult -band 65535) -ne 32) { throw } }
      if ($null -ne $ready) {
        try { if ($ready.Length -gt 1024) { throw 'Oversized readiness' }; $reader = [IO.StreamReader]::new($ready); try { $record = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() } }
        finally { $ready.Dispose() }
        if (@($record.PSObject.Properties).Count -ne 5 -or $record.schema -ne 1 -or $record.token -cne 'DSH_UPDATE_READY' -or $record.nonce -cne $config.nonce -or $record.pid -ne $worker.Id -or $record.started -cne $started) { throw 'Wrong worker readiness' }
        [Console]::Out.WriteLine('DSH_UPDATE_READY'); [Console]::Out.Flush()
        $acknowledged = $true
        ${observe('bootstrap-ready')}
      }
    }
    $decisionPath = [IO.Path]::Combine($config.signal,'decision')
    if ([IO.File]::Exists($decisionPath)) {
      $decision = [IO.FileInfo]::new($decisionPath)
      if (!$acknowledged -or ($decision.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $decision.Length -ne 64 -or [IO.File]::ReadAllText($decisionPath) -cne $config.nonce) { throw 'Handoff cancelled' }
      $approved = $true
      ${observe('bootstrap-decision')}
      break
    }
    [Threading.Thread]::Sleep(100)
  }
  if (!$approved) { throw 'Handoff acknowledgement timed out' }
} catch { Trace 'F'; ${observe('bootstrap-failed')} exit 1 }
finally {
  ${observe('bootstrap-finally')}
  if($null -ne $self){$self.Dispose()}
  if ($null -ne $worker) {
    if (!$approved -and !$worker.HasExited) { $worker.Kill(); if (!$worker.WaitForExit(5000)) { throw 'Worker cleanup incomplete' } }
    $worker.Dispose()
  }
}
`
  let encoded = Buffer.from(script, 'utf16le').toString('base64')
  if (encoded.length > 28_000) {
    // Optional observations cannot displace the actual handoff in Windows' command-line budget.
    let unobserved = script.replaceAll(phases, '')
    for (const call of phaseCalls) unobserved = unobserved.replaceAll(call, '')
    encoded = Buffer.from(unobserved, 'utf16le').toString('base64')
  }
  if (encoded.length > 28_000) throw new Error('Windows update command exceeds its safe size limit.')
  const env: NodeJS.ProcessEnv = { SYSTEMROOT: options.systemRoot, WINDIR: options.systemRoot }
  for (const key of ['USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'PATH']) {
    const value = options.environment?.[key]
    if (value !== undefined) env[key] = value
  }
  return {
    executable: win32.join(options.systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], env,
  }
}

/**
 * Resolve only after the verified independent worker is committed and the short bootstrap has closed.
 * @param descriptor Verified native Setup selected by the update service.
 * @returns The worker PID; failure leaves the application open and retains the payload.
 */
export async function launchWindowsDesktopInstaller(descriptor: VerifiedDesktopUpdate): Promise<number> {
  if (process.platform !== 'win32') throw new Error('Windows Setup requires an installed Windows application.')
  await verifyDesktopUpdateFile(descriptor)
  const signal = await createWindowsUpdateSignal(descriptor.stagingDirectory)
  let worker: WindowsUpdateWorker | undefined
  const decision = new WindowsUpdateDecision(signal, async () => {
    worker = await readWindowsUpdateSignal(signal)
    return worker
  })
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows'
  const command = createWindowsUpdateCommand(descriptor, {
    parentPid: process.pid, parentExecutable: process.execPath,
    systemRoot, environment: process.env, signal,
  })
  const child = spawn(command.executable, command.args, {
    detached: false, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: command.env,
  })
  let output = ''
  let failed = false
  const hasFailed = (): boolean => failed
  let acknowledge: () => void = () => {}
  let refuse: () => void = () => {}
  const ready = new Promise<void>((resolve, reject) => {
    acknowledge = resolve
    refuse = () => { reject(new Error('Windows update bootstrap did not acknowledge.')) }
  })
  const fail = (): void => {
    failed = true
    refuse()
    void decision.cancel().catch(() => {
      // Keep the rejection and deadline when the owned cancellation file is inaccessible.
    })
  }
  const closed = new Promise<void>((resolve) => {
    child.once('close', () => {
      if (child.exitCode !== 0 || child.signalCode !== null || !isWindowsBootstrapReady(output)) fail()
      refuse()
      resolve()
    })
  })
  child.once('error', fail)
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    if (output.length + chunk.length > 128) { fail(); return }
    output += chunk
    if (isWindowsBootstrapReady(output)) acknowledge()
    else if (!'DSH_UPDATE_READY\r\n'.startsWith(output) && !'DSH_UPDATE_READY\n'.startsWith(output)) {
      fail()
    }
  })
  const timer = setTimeout(() => {
    failed = true
    refuse()
    // Missing or cancelled approval also prevents a surviving worker from
    // executing Setup if this application is later closed manually.
    void decision.cancel().catch(() => {
      // An inaccessible private signal still leaves readiness unconfirmed.
    }).then(() => { child.kill() })
  }, 30_000)
  timer.unref()
  try {
    await ready
    if (hasFailed()) throw new Error('Invalid bootstrap readiness.')
    worker = await decision.approve()
    await closed
    if (hasFailed() || child.exitCode !== 0 || child.signalCode !== null
      || !isWindowsBootstrapReady(output)) {
      throw new Error('Bootstrap did not commit the worker.')
    }
    return worker.pid
  } catch {
    await decision.cancel().catch(() => {
      // The private signal may be inaccessible; the bootstrap deadline remains armed.
    })
    await closed
    if (worker !== undefined) {
      try { await stopWindowsUpdateWorker(worker, systemRoot) }
      catch { throw new Error('Windows update worker cleanup was not confirmed. The application has not been closed.') }
    }
    throw new Error('Could not prepare Windows Setup. The application has not been closed.')
  } finally {
    clearTimeout(timer)
    child.stdout.destroy()
  }
}
