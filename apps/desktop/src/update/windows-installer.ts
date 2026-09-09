import { spawn } from 'node:child_process'
import { win32 } from 'node:path'
import { validateDesktopUpdateManifest, type VerifiedDesktopUpdate } from './release.ts'
import { verifyDesktopUpdateFile } from './verification.ts'

interface WindowsUpdateCommandOptions {
  parentPid: number
  parentExecutable: string
  systemRoot: string
  environment?: NodeJS.ProcessEnv
}

/** Independent system process: it never holds the installed Electron EXE open during replacement. */
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
    || validateDesktopUpdateManifest({
      schema: 2, ...descriptor.target, desktopVersion: descriptor.desktopVersion, harnessVersion: descriptor.harnessVersion,
      assetName: descriptor.assetName, bytes: descriptor.bytes, sha256: descriptor.sha256,
      releaseUrl: `https://github.com/Missher12/deepseek-harness-desktop/releases/tag/desktop-v${descriptor.desktopVersion}`,
    }, descriptor.target) === null) throw new Error('Invalid Windows update handoff.')
  const config = Buffer.from(JSON.stringify({
    parentPid: options.parentPid, parentExecutable: options.parentExecutable,
    path: descriptor.localPath, stage: descriptor.stagingDirectory,
    name: descriptor.assetName, bytes: descriptor.bytes, sha256: descriptor.sha256,
  })).toString('base64')
  // Only base64 data is substituted. No renderer-supplied script, command or arguments.
  const script = `
$ErrorActionPreference = 'Stop'
try {
  $config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${config}')) | ConvertFrom-Json
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
  if ($parent.MainModule.FileName -ine $config.parentExecutable) { throw 'Wrong parent process' }
  $preflight = Open-VerifiedPayload
  $preflight.Dispose()
  [Console]::Out.WriteLine('DSH_UPDATE_READY')
  [Console]::Out.Flush()
  if (!$parent.WaitForExit(120000)) { throw 'Application did not exit' }
  $parent.Dispose()
  $lockedPayload = Open-VerifiedPayload
  try {
    $setup = Start-Process -FilePath $config.path -WorkingDirectory $config.stage -WindowStyle Normal -PassThru
    if (!$setup.Id) { throw 'Setup did not start' }
    $setup.Dispose()
  } finally { $lockedPayload.Dispose() }
} catch { exit 1 }
`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
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

/** Resolve only after the helper has validated the payload and is waiting for this app to exit. */
export async function launchWindowsDesktopInstaller(descriptor: VerifiedDesktopUpdate): Promise<number> {
  if (process.platform !== 'win32') throw new Error('Windows Setup requires an installed Windows application.')
  await verifyDesktopUpdateFile(descriptor)
  const command = createWindowsUpdateCommand(descriptor, {
    parentPid: process.pid, parentExecutable: process.execPath,
    systemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows', environment: process.env,
  })
  return await new Promise<number>((fulfill, reject) => {
    const child = spawn(command.executable, command.args, {
      detached: true, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: command.env,
    })
    let settled = false
    let output = ''
    const finish = (success: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout.destroy()
      if (success && child.pid !== undefined) {
        child.unref()
        fulfill(child.pid)
      } else {
        child.kill()
        reject(new Error('Could not prepare Windows Setup. The application has not been closed.'))
      }
    }
    const timer = setTimeout(() => { finish(false) }, 30_000)
    timer.unref()
    child.on('error', () => { finish(false) })
    child.once('exit', () => { finish(false) })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      if (output.length > 128) finish(false)
      else if (output === 'DSH_UPDATE_READY\r\n' || output === 'DSH_UPDATE_READY\n') finish(true)
    })
  })
}
