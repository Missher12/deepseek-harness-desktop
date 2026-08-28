param(
  [Parameter(Mandatory = $true)]
  [string]$HelperPath,
  [switch]$MediumIntegrityChild,
  [string]$ProgressPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Set-SmokeProgress {
  param([Parameter(Mandatory = $true)][string]$State)
  if ($ProgressPath.Length -gt 0) {
    [IO.File]::WriteAllText($ProgressPath, $State, [Text.UTF8Encoding]::new($false))
  }
}

function Invoke-MediumIntegritySmoke {
  param(
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [Parameter(Mandatory = $true)][string]$ResolvedHelperPath
  )

  if (-not ('DshWindowsSmoke.LimitedProcess' -as [type])) {
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace DshWindowsSmoke
{
    public static class LimitedProcess
    {
        private const uint TOKEN_ALL_ACCESS = 0x000F01FF;
        private const uint LUA_TOKEN = 0x4;
        private const int TokenLinkedToken = 19;
        private const uint CREATE_NO_WINDOW = 0x08000000;
        private const uint WAIT_OBJECT_0 = 0;
        private const uint WAIT_TIMEOUT = 258;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            public uint cb;
            public IntPtr lpReserved;
            public IntPtr lpDesktop;
            public IntPtr lpTitle;
            public uint dwX;
            public uint dwY;
            public uint dwXSize;
            public uint dwYSize;
            public uint dwXCountChars;
            public uint dwYCountChars;
            public uint dwFillAttribute;
            public uint dwFlags;
            public ushort wShowWindow;
            public ushort cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public uint dwProcessId;
            public uint dwThreadId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct TOKEN_LINKED_TOKEN
        {
            public IntPtr LinkedToken;
        }

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetCurrentProcess();

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateProcess(IntPtr process, uint exitCode);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool OpenProcessToken(
            IntPtr process,
            uint desiredAccess,
            out IntPtr token);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool GetTokenInformation(
            IntPtr token,
            int tokenInformationClass,
            out TOKEN_LINKED_TOKEN tokenInformation,
            uint tokenInformationLength,
            out uint returnLength);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool CreateRestrictedToken(
            IntPtr existingToken,
            uint flags,
            uint disableSidCount,
            IntPtr sidsToDisable,
            uint deletePrivilegeCount,
            IntPtr privilegesToDelete,
            uint restrictedSidCount,
            IntPtr sidsToRestrict,
            out IntPtr newToken);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateProcessWithTokenW(
            IntPtr token,
            uint logonFlags,
            string applicationName,
            StringBuilder commandLine,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref STARTUPINFO startupInfo,
            out PROCESS_INFORMATION processInformation);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateProcessAsUserW(
            IntPtr token,
            string applicationName,
            StringBuilder commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            bool inheritHandles,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref STARTUPINFO startupInfo,
            out PROCESS_INFORMATION processInformation);

        public static int Run(
            string applicationPath,
            string commandLine,
            string workingDirectory,
            int timeoutMilliseconds)
        {
            IntPtr sourceToken = IntPtr.Zero;
            IntPtr limitedToken = IntPtr.Zero;
            PROCESS_INFORMATION process = new PROCESS_INFORMATION();
            try
            {
                if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, out sourceToken))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcessToken failed");
                TOKEN_LINKED_TOKEN linked;
                uint linkedLength;
                if (GetTokenInformation(
                        sourceToken,
                        TokenLinkedToken,
                        out linked,
                        (uint)Marshal.SizeOf<TOKEN_LINKED_TOKEN>(),
                        out linkedLength))
                {
                    limitedToken = linked.LinkedToken;
                }
                else if (!CreateRestrictedToken(
                             sourceToken,
                             LUA_TOKEN,
                             0,
                             IntPtr.Zero,
                             0,
                             IntPtr.Zero,
                             0,
                             IntPtr.Zero,
                             out limitedToken))
                {
                    throw new Win32Exception(
                        Marshal.GetLastWin32Error(),
                        "Linked and restricted token creation failed");
                }

                STARTUPINFO startup = new STARTUPINFO();
                startup.cb = (uint)Marshal.SizeOf<STARTUPINFO>();
                StringBuilder mutableCommand = new StringBuilder(commandLine);
                bool created = CreateProcessWithTokenW(
                        limitedToken,
                        0,
                        applicationPath,
                        mutableCommand,
                        CREATE_NO_WINDOW,
                        IntPtr.Zero,
                        workingDirectory,
                        ref startup,
                        out process);
                int withTokenError = created ? 0 : Marshal.GetLastWin32Error();
                if (!created)
                {
                    mutableCommand = new StringBuilder(commandLine);
                    created = CreateProcessAsUserW(
                        limitedToken,
                        applicationPath,
                        mutableCommand,
                        IntPtr.Zero,
                        IntPtr.Zero,
                        false,
                        CREATE_NO_WINDOW,
                        IntPtr.Zero,
                        workingDirectory,
                        ref startup,
                        out process);
                }
                if (!created)
                {
                    int asUserError = Marshal.GetLastWin32Error();
                    throw new Win32Exception(
                        asUserError,
                        "Limited process creation failed (with-token=" + withTokenError +
                        ", as-user=" + asUserError + ")");
                }

                uint wait = WaitForSingleObject(process.hProcess, (uint)timeoutMilliseconds);
                if (wait == WAIT_TIMEOUT)
                {
                    TerminateProcess(process.hProcess, 124);
                    WaitForSingleObject(process.hProcess, 5000);
                    throw new TimeoutException("Medium-integrity Windows Computer Use smoke timed out");
                }
                if (wait != WAIT_OBJECT_0)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "WaitForSingleObject failed");
                if (!GetExitCodeProcess(process.hProcess, out uint exitCode))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "GetExitCodeProcess failed");
                return unchecked((int)exitCode);
            }
            finally
            {
                if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
                if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
                if (limitedToken != IntPtr.Zero) CloseHandle(limitedToken);
                if (sourceToken != IntPtr.Zero) CloseHandle(sourceToken);
            }
        }
    }
}
'@
  }

  $resultPath = Join-Path ([IO.Path]::GetTempPath()) "dsh-windows-control-$([Guid]::NewGuid().ToString('N')).txt"
  $scriptLiteral = $ScriptPath.Replace("'", "''")
  $helperLiteral = $ResolvedHelperPath.Replace("'", "''")
  $resultLiteral = $resultPath.Replace("'", "''")
  $childSource = @"
`$ErrorActionPreference = 'Stop'
try {
  & '$scriptLiteral' -HelperPath '$helperLiteral' -MediumIntegrityChild
  [IO.File]::WriteAllText('$resultLiteral', 'PASS', [Text.UTF8Encoding]::new(`$false))
  exit 0
}
catch {
  `$message = [string]`$_.Exception.Message
  if (`$message.Length -gt 1024) { `$message = `$message.Substring(0, 1024) }
  [IO.File]::WriteAllText('$resultLiteral', "FAIL: `$message", [Text.UTF8Encoding]::new(`$false))
  exit 1
}
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childSource))
  $pwsh = (Get-Process -Id $PID).Path
  $arguments = "-NoLogo -NoProfile -NonInteractive -STA -EncodedCommand $encoded"
  $commandLine = "`"$pwsh`" $arguments"
  try {
    $exitCode = [DshWindowsSmoke.LimitedProcess]::Run(
      $pwsh,
      $commandLine,
      (Split-Path -Parent $ScriptPath),
      60000
    )
    $result = if (Test-Path -LiteralPath $resultPath) {
      (Get-Content -LiteralPath $resultPath -Raw).Trim()
    } else {
      'FAIL: medium-integrity smoke did not produce a result'
    }
    if ($exitCode -ne 0 -or $result -ne 'PASS') {
      throw "Windows Computer Use medium-integrity acceptance failed (exit=$exitCode): $result"
    }
    Write-Host 'Windows Computer Use medium-integrity acceptance passed.'
  }
  finally {
    Remove-Item -LiteralPath $resultPath -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-StandardUserSmoke {
  param(
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [Parameter(Mandatory = $true)][string]$ResolvedHelperPath
  )

  if (-not ('DshWindowsSmoke.StandardUserProcess' -as [type])) {
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace DshWindowsSmoke
{
    public static class StandardUserProcess
    {
        private const uint LOGON_WITH_PROFILE = 0x1;
        private const uint CREATE_NEW_CONSOLE = 0x10;
        private const uint WAIT_OBJECT_0 = 0;
        private const uint WAIT_TIMEOUT = 258;

        [StructLayout(LayoutKind.Sequential)]
        private struct STARTUPINFO
        {
            public uint cb;
            public IntPtr lpReserved;
            public IntPtr lpDesktop;
            public IntPtr lpTitle;
            public uint dwX;
            public uint dwY;
            public uint dwXSize;
            public uint dwYSize;
            public uint dwXCountChars;
            public uint dwYCountChars;
            public uint dwFillAttribute;
            public uint dwFlags;
            public ushort wShowWindow;
            public ushort cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public uint dwProcessId;
            public uint dwThreadId;
        }

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateProcessWithLogonW(
            string userName,
            string domain,
            string password,
            uint logonFlags,
            string applicationName,
            StringBuilder commandLine,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref STARTUPINFO startupInfo,
            out PROCESS_INFORMATION processInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateProcess(IntPtr process, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        public static int Run(
            string userName,
            string domain,
            string password,
            string applicationPath,
            string commandLine,
            string workingDirectory,
            int timeoutMilliseconds)
        {
            PROCESS_INFORMATION process = new PROCESS_INFORMATION();
            IntPtr desktop = Marshal.StringToHGlobalUni("winsta0\\default");
            try
            {
                STARTUPINFO startup = new STARTUPINFO();
                startup.cb = (uint)Marshal.SizeOf<STARTUPINFO>();
                startup.lpDesktop = desktop;
                StringBuilder mutableCommand = new StringBuilder(commandLine);
                if (!CreateProcessWithLogonW(
                        userName,
                        domain,
                        password,
                        LOGON_WITH_PROFILE,
                        applicationPath,
                        mutableCommand,
                        CREATE_NEW_CONSOLE,
                        IntPtr.Zero,
                        workingDirectory,
                        ref startup,
                        out process))
                {
                    int createError = Marshal.GetLastWin32Error();
                    throw new Win32Exception(
                        createError,
                        "CreateProcessWithLogonW failed (error=" + createError + ")");
                }

                uint wait = WaitForSingleObject(process.hProcess, (uint)timeoutMilliseconds);
                if (wait == WAIT_TIMEOUT)
                {
                    TerminateProcess(process.hProcess, 124);
                    WaitForSingleObject(process.hProcess, 5000);
                    throw new TimeoutException("Standard-user Windows Computer Use smoke timed out");
                }
                if (wait != WAIT_OBJECT_0)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "WaitForSingleObject failed");
                if (!GetExitCodeProcess(process.hProcess, out uint exitCode))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "GetExitCodeProcess failed");
                return unchecked((int)exitCode);
            }
            finally
            {
                if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
                if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
                Marshal.FreeHGlobal(desktop);
            }
        }
    }
}
'@
  }

  $suffix = [Guid]::NewGuid().ToString('N')
  $userName = "dshsmoke$($suffix.Substring(0, 8))"
  $password = "Dsh!7aA$($suffix.Substring(8, 24))"
  $stagingRoot = Join-Path $env:PUBLIC "dsh-windows-control-$suffix"
  $stagedScript = Join-Path $stagingRoot 'windows-computer-use-smoke.ps1'
  $stagedHelper = Join-Path $stagingRoot 'computer-use-helper.exe'
  $wrapperPath = Join-Path $stagingRoot 'run-smoke.ps1'
  $resultPath = Join-Path $stagingRoot 'result.txt'
  $progressPath = Join-Path $stagingRoot 'progress.txt'
  $createdUser = $false

  try {
    New-Item -ItemType Directory -Path $stagingRoot | Out-Null
    Copy-Item -LiteralPath $ScriptPath -Destination $stagedScript
    Copy-Item -LiteralPath $ResolvedHelperPath -Destination $stagedHelper
    & icacls.exe $stagingRoot /grant '*S-1-5-32-545:(OI)(CI)M' /T /Q | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to grant the isolated smoke user access to its staging directory: $LASTEXITCODE"
    }

    $securePassword = ConvertTo-SecureString -String $password -AsPlainText -Force
    New-LocalUser -Name $userName -Password $securePassword -AccountNeverExpires `
      -PasswordNeverExpires -UserMayNotChangePassword | Out-Null
    $createdUser = $true

    $scriptLiteral = $stagedScript.Replace("'", "''")
    $helperLiteral = $stagedHelper.Replace("'", "''")
    $resultLiteral = $resultPath.Replace("'", "''")
    $progressLiteral = $progressPath.Replace("'", "''")
    $childSource = @"
`$ErrorActionPreference = 'Stop'
try {
  [IO.File]::WriteAllText('$progressLiteral', 'wrapper-started', [Text.UTF8Encoding]::new(`$false))
  & '$scriptLiteral' -HelperPath '$helperLiteral' -MediumIntegrityChild -ProgressPath '$progressLiteral'
  [IO.File]::WriteAllText('$resultLiteral', 'PASS', [Text.UTF8Encoding]::new(`$false))
  exit 0
}
catch {
  `$message = [string]`$_.Exception.Message
  if (`$message.Length -gt 1024) { `$message = `$message.Substring(0, 1024) }
  [IO.File]::WriteAllText('$resultLiteral', "FAIL: `$message", [Text.UTF8Encoding]::new(`$false))
  exit 1
}
"@
    [IO.File]::WriteAllText($wrapperPath, $childSource, [Text.UTF8Encoding]::new($false))
    $pwsh = (Get-Process -Id $PID).Path
    $commandLine = "`"$pwsh`" -NoLogo -NoProfile -NonInteractive -STA -File `"$wrapperPath`""
    try {
      $exitCode = [DshWindowsSmoke.StandardUserProcess]::Run(
        $userName,
        $env:COMPUTERNAME,
        $password,
        $pwsh,
        $commandLine,
        $stagingRoot,
        60000
      )
    }
    catch {
      $progress = if (Test-Path -LiteralPath $progressPath) {
        (Get-Content -LiteralPath $progressPath -Raw).Trim()
      } else {
        'process-not-started'
      }
      throw "Standard-user smoke stalled at '$progress': $($_.Exception.Message)"
    }
    $result = if (Test-Path -LiteralPath $resultPath) {
      (Get-Content -LiteralPath $resultPath -Raw).Trim()
    } else {
      'FAIL: standard-user smoke did not produce a result'
    }
    if ($exitCode -ne 0 -or $result -ne 'PASS') {
      throw "Windows Computer Use standard-user acceptance failed (exit=$exitCode): $result"
    }
    Write-Host 'Windows Computer Use standard-user acceptance passed.'
  }
  finally {
    if ($createdUser) {
      Remove-LocalUser -Name $userName -ErrorAction Continue
    }
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$resolvedHelper = (Resolve-Path -LiteralPath $HelperPath).Path
if (-not $MediumIntegrityChild) {
  Invoke-MediumIntegritySmoke -ScriptPath $PSCommandPath -ResolvedHelperPath $resolvedHelper
  return
}

Set-SmokeProgress 'child-entered'

function Read-ExactBytes {
  param(
    [Parameter(Mandatory = $true)]
    [System.IO.Stream]$Stream,
    [Parameter(Mandatory = $true)]
    [int]$Count
  )

  $buffer = [byte[]]::new($Count)
  $offset = 0
  while ($offset -lt $Count) {
    $read = $Stream.Read($buffer, $offset, $Count - $offset)
    if ($read -eq 0) {
      throw "Native helper closed stdout with $($Count - $offset) byte(s) still expected."
    }
    $offset += $read
  }
  return ,$buffer
}

function Read-HelperFrame {
  param([Parameter(Mandatory = $true)][System.IO.Stream]$Stream)

  $header = Read-ExactBytes -Stream $Stream -Count 4
  [Array]::Reverse($header)
  $length = [BitConverter]::ToUInt32($header, 0)
  if ($length -lt 1 -or $length -gt 4194321) {
    throw "Native helper returned an invalid frame length: $length"
  }
  return [PSCustomObject]@{ Body = Read-ExactBytes -Stream $Stream -Count ([int]$length) }
}

function Write-HelperJson {
  param(
    [Parameter(Mandatory = $true)]
    [System.IO.Stream]$Stream,
    [Parameter(Mandatory = $true)]
    [System.Collections.IDictionary]$Message
  )

  $json = $Message | ConvertTo-Json -Compress -Depth 16
  $payload = [Text.Encoding]::UTF8.GetBytes($json)
  $body = [byte[]]::new($payload.Length + 1)
  $body[0] = 0x01
  [Buffer]::BlockCopy($payload, 0, $body, 1, $payload.Length)
  $prefix = [BitConverter]::GetBytes([uint32]$body.Length)
  [Array]::Reverse($prefix)
  $Stream.Write($prefix, 0, $prefix.Length)
  $Stream.Write($body, 0, $body.Length)
  $Stream.Flush()
}

function New-HelperRequest {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RequestKind,
    [Parameter(Mandatory = $true)]
    [string]$SessionId,
    [System.Collections.IDictionary]$Fields = @{}
  )

  $message = [ordered]@{
    protocolVersion = 1
    messageKind = 'request'
    requestKind = $RequestKind
    requestId = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
    sessionId = $SessionId
    timeoutMs = 10000
  }
  foreach ($key in $Fields.Keys) {
    $message[$key] = $Fields[$key]
  }
  return $message
}

function Invoke-HelperRequest {
  param(
    [Parameter(Mandatory = $true)]
    [System.IO.Stream]$InputStream,
    [Parameter(Mandatory = $true)]
    [System.IO.Stream]$OutputStream,
    [Parameter(Mandatory = $true)]
    [System.Collections.IDictionary]$Request,
    [switch]$ExpectPng
  )

  Write-HelperJson -Stream $InputStream -Message $Request
  $frame = Read-HelperFrame -Stream $OutputStream
  if ($frame.Body[0] -ne 0x01) {
    throw 'Native helper response was not a JSON frame.'
  }
  $jsonBytes = [byte[]]$frame.Body[1..($frame.Body.Length - 1)]
  $responseText = [Text.Encoding]::UTF8.GetString($jsonBytes)
  $response = $responseText | ConvertFrom-Json -Depth 16
  if ($response.requestId -ne $Request.requestId -or $response.requestKind -ne $Request.requestKind) {
    throw 'Native helper response correlation did not match the request.'
  }

  $png = $null
  if ($ExpectPng) {
    $pngFrame = Read-HelperFrame -Stream $OutputStream
    if ($pngFrame.Body[0] -ne 0x02 -or $pngFrame.Body.Length -lt 25) {
      throw 'Native helper did not return a valid adjacent PNG frame.'
    }
    $png = [byte[]]$pngFrame.Body[17..($pngFrame.Body.Length - 1)]
    $signature = [byte[]](0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    for ($index = 0; $index -lt $signature.Length; $index++) {
      if ($png[$index] -ne $signature[$index]) {
        throw 'Native helper PNG frame has an invalid signature.'
      }
    }
  }
  return [PSCustomObject]@{ Response = $response; Text = $responseText; Png = $png }
}

function Assert-HelperSuccess {
  param([Parameter(Mandatory = $true)]$Exchange)
  if ($Exchange.Response.responseKind -ne 'ok') {
    throw "Native helper request failed: $($Exchange.Response.error.code)"
  }
}

function Assert-HelperError {
  param(
    [Parameter(Mandatory = $true)]$Exchange,
    [Parameter(Mandatory = $true)][string]$Code
  )
  if ($Exchange.Response.responseKind -ne 'error' -or $Exchange.Response.error.code -ne $Code) {
    throw "Expected native helper error $Code, got: $($Exchange.Text)"
  }
}

function Start-FixtureWindow {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][ValidateSet('button', 'protected')][string]$Kind,
    [Parameter(Mandatory = $true)][int]$Left
  )

  $fixtureSource = @"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
`$form = [System.Windows.Forms.Form]::new()
`$form.Text = '$Title'
`$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
`$form.Location = [System.Drawing.Point]::new($Left, 160)
`$form.Size = [System.Drawing.Size]::new(420, 220)
if ('$Kind' -eq 'protected') {
  `$field = [System.Windows.Forms.TextBox]::new()
  `$field.Name = 'ProtectedInput'
  `$field.AccessibleName = 'Protected input'
  `$field.UseSystemPasswordChar = `$true
  `$field.Text = 'DSH_SECRET_DO_NOT_EXPOSE'
  `$field.Location = [System.Drawing.Point]::new(80, 70)
  `$field.Size = [System.Drawing.Size]::new(240, 30)
  `$form.Controls.Add(`$field)
} else {
  `$button = [System.Windows.Forms.Button]::new()
  `$button.Name = 'HarmlessAction'
  `$button.AccessibleName = 'Harmless action'
  `$button.Text = 'Harmless action'
  `$button.Location = [System.Drawing.Point]::new(110, 65)
  `$button.Size = [System.Drawing.Size]::new(180, 45)
  `$form.Controls.Add(`$button)
}
`$form.Add_Shown({ `$form.Activate() })
[void]`$form.ShowDialog()
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($fixtureSource))
  $pwsh = (Get-Process -Id $PID).Path
  $fixtureInfo = [System.Diagnostics.ProcessStartInfo]::new($pwsh)
  $fixtureInfo.UseShellExecute = $false
  $fixtureInfo.CreateNoWindow = $false
  $fixtureInfo.RedirectStandardError = $true
  [void]$fixtureInfo.ArgumentList.Add('-STA')
  [void]$fixtureInfo.ArgumentList.Add('-NoLogo')
  [void]$fixtureInfo.ArgumentList.Add('-NoProfile')
  [void]$fixtureInfo.ArgumentList.Add('-NonInteractive')
  [void]$fixtureInfo.ArgumentList.Add('-EncodedCommand')
  [void]$fixtureInfo.ArgumentList.Add($encoded)
  $fixture = [System.Diagnostics.Process]::Start($fixtureInfo)
  if ($null -eq $fixture) {
    throw "Windows did not start fixture window: $Title"
  }
  return $fixture
}

function Assert-FixtureProcessesRunning {
  param([Parameter(Mandatory = $true)][System.Diagnostics.Process[]]$Processes)

  for ($index = 0; $index -lt $Processes.Count; $index++) {
    $process = $Processes[$index]
    if ($process.HasExited) {
      $stderr = $process.StandardError.ReadToEnd().Trim()
      if ($stderr.Length -gt 512) {
        $stderr = $stderr.Substring(0, 512)
      }
      throw "Fixture process $index exited before enumeration (code=$($process.ExitCode), stderr=$stderr)."
    }
  }
}

function Find-ListedWindow {
  param(
    [Parameter(Mandatory = $true)]$Apps,
    [Parameter(Mandatory = $true)][string]$Title
  )
  foreach ($app in @($Apps)) {
    foreach ($window in @($app.windows)) {
      if ($window.title -eq $Title) {
        return [PSCustomObject]@{
          appId = [string]$app.appId
          windowId = [string]$window.windowId
          title = [string]$window.title
        }
      }
    }
  }
  return $null
}

function Stop-FixtureProcess {
  param([System.Diagnostics.Process]$Process)
  if ($null -eq $Process) { return }
  try {
    if (-not $Process.HasExited) {
      [void]$Process.CloseMainWindow()
      if (-not $Process.WaitForExit(3000)) {
        $Process.Kill($true)
        [void]$Process.WaitForExit(5000)
      }
    }
  }
  finally {
    $Process.Dispose()
  }
}

$helperInfo = [System.Diagnostics.ProcessStartInfo]::new($resolvedHelper)
$helperInfo.UseShellExecute = $false
$helperInfo.CreateNoWindow = $true
$helperInfo.RedirectStandardInput = $true
$helperInfo.RedirectStandardOutput = $true
$helperInfo.RedirectStandardError = $true
$helper = $null
$fixtures = @()
$sessionId = 'windows-native-acceptance'
$leaseId = [Guid]::NewGuid().ToString('D').ToLowerInvariant()
$leaseRevision = 1

try {
  $fixtures = @(
    Start-FixtureWindow -Title 'DSH Computer Fixture Alpha' -Kind button -Left 120
    Start-FixtureWindow -Title 'DSH Computer Fixture Beta' -Kind button -Left 620
    Start-FixtureWindow -Title 'DSH Protected Fixture' -Kind protected -Left 360
  )
  Set-SmokeProgress 'fixtures-started'
  $helper = [System.Diagnostics.Process]::Start($helperInfo)
  if ($null -eq $helper) {
    throw 'Windows did not start the packaged Computer Use helper.'
  }
  Set-SmokeProgress 'helper-started'
  $inputStream = $helper.StandardInput.BaseStream
  $outputStream = $helper.StandardOutput.BaseStream

  $statusRequest = New-HelperRequest -RequestKind 'status' -SessionId $sessionId
  $status = Invoke-HelperRequest -InputStream $inputStream -OutputStream $outputStream -Request $statusRequest
  Assert-HelperSuccess $status
  Set-SmokeProgress 'status-complete'
  if ($status.Response.result.supported -ne $true -or
      $status.Response.result.viewing -ne 'granted' -or
      $status.Response.result.assistive -ne 'granted') {
    throw "Windows native Computer Use is unavailable: $($status.Text)"
  }

  $alpha = $null
  $beta = $null
  $protected = $null
  $listDeadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    Assert-FixtureProcessesRunning -Processes $fixtures
    $listRequest = New-HelperRequest -RequestKind 'list' -SessionId $sessionId
    $listed = Invoke-HelperRequest -InputStream $inputStream -OutputStream $outputStream -Request $listRequest
    Assert-HelperSuccess $listed
    $alpha = Find-ListedWindow -Apps $listed.Response.result.apps -Title 'DSH Computer Fixture Alpha'
    $beta = Find-ListedWindow -Apps $listed.Response.result.apps -Title 'DSH Computer Fixture Beta'
    $protected = Find-ListedWindow -Apps $listed.Response.result.apps -Title 'DSH Protected Fixture'
    if ($null -eq $alpha -or $null -eq $beta -or $null -eq $protected) {
      Start-Sleep -Milliseconds 250
    }
  } while (($null -eq $alpha -or $null -eq $beta -or $null -eq $protected) -and
    [DateTime]::UtcNow -lt $listDeadline)
  if ($null -eq $alpha -or $null -eq $beta -or $null -eq $protected) {
    $appCount = @($listed.Response.result.apps).Count
    throw "Native Computer Use did not enumerate all exact fixture windows (apps=$appCount, alpha=$($null -ne $alpha), beta=$($null -ne $beta), protected=$($null -ne $protected))."
  }
  Set-SmokeProgress 'fixtures-enumerated'

  $targets = @($alpha, $beta, $protected) | ForEach-Object {
    [ordered]@{ appId = $_.appId; windowIds = @($_.windowId) }
  }
  $installRequest = New-HelperRequest -RequestKind 'lease.install' -SessionId $sessionId -Fields ([ordered]@{
    leaseId = $leaseId
    leaseRevision = $leaseRevision
    agentId = 'windows-native-acceptance'
    targets = $targets
    capabilities = @('observe', 'pointer', 'keyboard')
    quotas = [ordered]@{ operations = 100; snapshots = 10; pointerActions = 50; keyActions = 20; textBytes = 1024 }
    idleExpiresAfterMs = 300000
    hardExpiresAfterMs = 1200000
  })
  $installedLease = Invoke-HelperRequest -InputStream $inputStream -OutputStream $outputStream -Request $installRequest
  Assert-HelperSuccess $installedLease

  $alphaSnapshotRequest = New-HelperRequest -RequestKind 'snapshot' -SessionId $sessionId -Fields ([ordered]@{
    leaseId = $leaseId; leaseRevision = $leaseRevision; appId = $alpha.appId; windowId = $alpha.windowId
    snapshotRevision = 1; includeImage = $false
  })
  $alphaSnapshot = Invoke-HelperRequest -InputStream $inputStream -OutputStream $outputStream -Request $alphaSnapshotRequest
  Assert-HelperSuccess $alphaSnapshot
  $alphaButton = @($alphaSnapshot.Response.result.refs | Where-Object {
    $_.role -eq 'button' -and $_.name -eq 'Harmless action'
  })
  if ($alphaButton.Count -ne 1) {
    throw 'UI Automation did not expose the exact harmless Alpha button.'
  }
  $clickRequest = New-HelperRequest -RequestKind 'click' -SessionId $sessionId -Fields ([ordered]@{
    leaseId = $leaseId; leaseRevision = $leaseRevision; appId = $alpha.appId; windowId = $alpha.windowId
    snapshotRevision = [uint64]$alphaSnapshot.Response.result.snapshotRevision
    ref = [string]$alphaButton[0].ref; button = 'left'
  })
  $clicked = Invoke-HelperRequest -InputStream $inputStream -OutputStream $outputStream -Request $clickRequest
  Assert-HelperSuccess $clicked

  $betaSnapshotRequest = New-HelperRequest -RequestKind 'snapshot' -SessionId $sessionId -Fields ([ordered]@{
    leaseId = $leaseId; leaseRevision = $leaseRevision; appId = $beta.appId; windowId = $beta.windowId
    snapshotRevision = 2; includeImage = $true
  })
  $betaSnapshot = Invoke-HelperRequest -InputStream $inputStream -OutputStream $outputStream -Request $betaSnapshotRequest -ExpectPng
  Assert-HelperSuccess $betaSnapshot
  if ($betaSnapshot.Png.Length -ne [int]$betaSnapshot.Response.result.image.byteLength) {
    throw 'Windows Graphics Capture PNG length did not match its metadata.'
  }
  $pngStream = [System.IO.MemoryStream]::new($betaSnapshot.Png, $false)
  try {
    $pngHash = (Get-FileHash -InputStream $pngStream -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  finally {
    $pngStream.Dispose()
  }
  if ($pngHash -ne $betaSnapshot.Response.result.image.sha256) {
    throw 'Windows Graphics Capture PNG hash did not match its metadata.'
  }
  $focusRequest = New-HelperRequest -RequestKind 'focus' -SessionId $sessionId -Fields ([ordered]@{
    leaseId = $leaseId; leaseRevision = $leaseRevision; appId = $beta.appId; windowId = $beta.windowId
    snapshotRevision = [uint64]$betaSnapshot.Response.result.snapshotRevision
  })
  $focused = Invoke-HelperRequest -InputStream $inputStream -OutputStream $outputStream -Request $focusRequest
  Assert-HelperSuccess $focused

  $protectedSnapshotRequest = New-HelperRequest -RequestKind 'snapshot' -SessionId $sessionId -Fields ([ordered]@{
    leaseId = $leaseId; leaseRevision = $leaseRevision; appId = $protected.appId; windowId = $protected.windowId
    snapshotRevision = 3; includeImage = $false
  })
  $protectedSnapshot = Invoke-HelperRequest -InputStream $inputStream -OutputStream $outputStream -Request $protectedSnapshotRequest
  Assert-HelperError -Exchange $protectedSnapshot -Code 'PERMISSION_DENIED'
  if ($protectedSnapshot.Text.Contains('DSH_SECRET_DO_NOT_EXPOSE')) {
    throw 'Protected UI Automation content leaked into the helper response.'
  }

  $stopRequest = New-HelperRequest -RequestKind 'stop' -SessionId $sessionId -Fields ([ordered]@{
    leaseId = $leaseId; leaseRevision = $leaseRevision
  })
  $stopped = Invoke-HelperRequest -InputStream $inputStream -OutputStream $outputStream -Request $stopRequest
  Assert-HelperSuccess $stopped
  $afterStop = Invoke-HelperRequest -InputStream $inputStream -OutputStream $outputStream -Request $focusRequest
  Assert-HelperError -Exchange $afterStop -Code 'LEASE_REVOKED'

  $inputStream.Close()
  if (-not $helper.WaitForExit(10000)) {
    throw 'Packaged Computer Use helper did not exit after stdin EOF.'
  }
  $stderr = $helper.StandardError.ReadToEnd()
  if ($helper.ExitCode -ne 0 -or $stderr.Length -ne 0) {
    throw "Packaged Computer Use helper exited unexpectedly: $stderr"
  }
  Write-Host 'Windows Computer Use smoke passed: UIA, WGC PNG, SendInput, protected-target denial, Stop, EOF, and two harmless windows.'
}
finally {
  if ($null -ne $helper) {
    if (-not $helper.HasExited) {
      try { $helper.StandardInput.Close() } catch { }
      if (-not $helper.WaitForExit(3000)) {
        $helper.Kill($true)
        [void]$helper.WaitForExit(5000)
      }
    }
    $helper.Dispose()
  }
  foreach ($fixture in $fixtures) {
    Stop-FixtureProcess -Process $fixture
  }
}
