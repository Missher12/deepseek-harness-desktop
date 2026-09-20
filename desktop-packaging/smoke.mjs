/** Launch an installed official Desktop with disposable data and retain bounded UI evidence. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

const repository = resolve(import.meta.dirname, '..')
const require = createRequire(join(repository, 'apps/web/package.json'))
const { _electron: electron } = require('playwright')
const execute = promisify(execFile)
const executable = process.argv[2]
const output = process.argv[3]
assert(executable && output, 'Usage: node desktop-packaging/smoke.mjs <executable> <evidence-directory>')
const expectedVersion = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8')).version
const isolated = await mkdtemp(join(tmpdir(), 'dsh-official-desktop-'))
const evidence = resolve(output)
await mkdir(evidence, { recursive: true })
const harnessHome = join(isolated, 'dsh-home')
const profile = join(harnessHome, 'profiles/desktop')
await mkdir(profile, { recursive: true })
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^DSH_|^DEEPSEEK_|^ELECTRON_|^NODE_OPTIONS$|^NODE_PATH$/iu.test(key)))
const report = { version: expectedVersion, platform: process.platform, arch: process.arch,
  packaged: false, uiReady: false, exited: false, ownedProcessesStopped: false, pageErrors: [] }
let application
let ownedPids = []

async function descendants(parent) {
  const { stdout } = process.platform === 'win32'
    ? await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'])
    : await execute('ps', ['-axo', 'pid=,ppid='])
  const rows = process.platform === 'win32'
    ? [].concat(JSON.parse(stdout)).map(row => [row.ProcessId, row.ParentProcessId])
    : stdout.trim().split('\n').map(line => line.trim().split(/\s+/u).map(Number))
  const found = new Set([parent])
  for (let before = -1; before !== found.size;) {
    before = found.size
    for (const [pid, ppid] of rows) if (found.has(ppid)) found.add(pid)
  }
  return [...found]
}

/** Observe sockets owned by the actual Host, without exposing its authentication URL. */
async function hostListener(parent) {
  let hostPid
  if (process.platform === 'win32') {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${parent}" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`])
    hostPid = [].concat(JSON.parse(stdout)).find(row => row.CommandLine?.includes('dsh-desktop-host'))?.ProcessId
  } else {
    const { stdout } = await execute('ps', ['-ww', '-axo', 'pid=,ppid=,command='])
    const row = stdout.split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/u))
      .find(parts => parts && Number(parts[2]) === parent && parts[3].includes('dsh-desktop-host'))
    hostPid = row ? Number(row[1]) : undefined
  }
  assert(Number.isSafeInteger(hostPid), 'Application-owned Host process is missing')
  let addresses
  if (process.platform === 'win32') {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-NetTCPConnection -State Listen -OwningProcess ${hostPid} | Select-Object LocalAddress,LocalPort | ConvertTo-Json -Compress`])
    addresses = [].concat(JSON.parse(stdout)).map(row => ({ host: row.LocalAddress, port: row.LocalPort }))
  } else {
    const { stdout } = await execute('lsof', ['-nP', '-a', '-p', String(hostPid), '-iTCP', '-sTCP:LISTEN', '-Fn'])
    addresses = stdout.split('\n').filter(line => line.startsWith('n')).map(line => {
      const separator = line.lastIndexOf(':')
      return { host: line.slice(1, separator), port: Number(line.slice(separator + 1)) }
    })
  }
  assert.equal(addresses.length, 1, 'Host must own one HTTP listener')
  const listener = addresses[0]
  assert.equal(listener.host, '127.0.0.1')
  assert(listener.port > 0 && listener.port !== 19387, 'Fresh Desktop must use its dynamic port default')
  const response = await fetch(`http://${listener.host}:${listener.port}/`, { signal: AbortSignal.timeout(10_000) })
  assert.equal(response.status, 401, 'Unauthenticated HTTP requests must remain protected')
  await response.body?.cancel()
  return { pid: hostPid, ...listener }
}

function alive(pid) {
  try { process.kill(pid, 0); return true }
  catch (error) { if (error.code === 'ESRCH') return false; throw error }
}

try {
  application = await electron.launch({ executablePath: resolve(executable),
    args: [`--user-data-dir=${join(isolated, 'electron')}`], cwd: isolated,
    env: { ...environment, HOME: isolated, USERPROFILE: isolated,
      APPDATA: join(isolated, 'appdata'), LOCALAPPDATA: join(isolated, 'localappdata'),
      DSH_HOME: harnessHome, DSH_TELEMETRY_DISABLED: '1',
      DSH_DESKTOP_UPDATE_JOURNAL_DIR: join(evidence, 'journal'),
      DSH_DESKTOP_DIAGNOSTIC_FILE: join(evidence, 'startup-error.txt') }, timeout: 120_000 })
  const child = application.process()
  const exited = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })))
  const page = await application.firstWindow({ timeout: 120_000 })
  page.on('pageerror', error => { report.pageErrors.push(error.message) })
  await page.getByRole('button', { name: /^(New session|新建会话|新会话)$/u }).first().waitFor({ timeout: 120_000 })
  const actual = await application.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged }))
  assert.equal(actual.version, expectedVersion)
  assert.equal(actual.packaged, true)
  assert(page.url().startsWith('dsh-app://app/'), 'Official packaged application origin is missing')
  report.packaged = actual.packaged
  report.uiReady = true
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}), [], 'Fresh profile contains an external plugin')
  const journalFiles = await readdir(join(evidence, 'journal'))
  const events = (await Promise.all(journalFiles.filter(name => name.endsWith('.jsonl'))
    .map(name => readFile(join(evidence, 'journal', name), 'utf8')))).join('\n')
  assert(events.split('\n').filter(Boolean).map(line => JSON.parse(line))
    .some(event => event.event === 'workspace-ready'), 'Official Host never reached readiness')
  report.host = await hostListener(child.pid)
  await page.screenshot({ path: join(evidence, 'official-desktop.png') })
  ownedPids = await descendants(child.pid)
  await application.close()
  application = undefined
  const outcome = await exited
  assert.equal(outcome.signal, null, 'Application was terminated by a signal')
  assert.equal(outcome.code, 0, 'Application did not exit successfully')
  report.exited = true
  const deadline = Date.now() + 15_000
  while (ownedPids.some(alive) && Date.now() < deadline) await delay(100)
  assert.deepEqual(ownedPids.filter(alive), [], 'Owned processes survived Desktop exit')
  report.ownedProcessesStopped = true
  assert.deepEqual(report.pageErrors, [], 'Renderer raised an uncaught exception')
} catch (error) {
  report.error = String(error).replace(/([?&]token=)[^\s&]+/gu, '$1[REDACTED]')
  throw error
} finally {
  try {
    if (application !== undefined) {
      ownedPids = await descendants(application.process().pid)
      await application.close()
      const deadline = Date.now() + 15_000
      while (ownedPids.some(alive) && Date.now() < deadline) await delay(100)
      report.ownedProcessesStopped = !ownedPids.some(alive)
      assert(report.ownedProcessesStopped, 'Owned processes survived failure cleanup')
    }
  } finally {
    await writeFile(join(evidence, 'smoke.json'), `${JSON.stringify(report, null, 2)}\n`)
    if (!ownedPids.some(alive)) await rm(isolated, { recursive: true, force: true })
  }
}
console.log(`Official Desktop ${expectedVersion}: packaged UI ready, clean exit (${process.platform}-${process.arch})`)
