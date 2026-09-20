/** Mount one Intel DMG, install into a disposable directory, and verify its native lifecycle. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

assert(process.platform === 'darwin' && process.arch === 'x64', 'Intel macOS is required')
assert(process.argv[2] && process.argv[3], 'Usage: node desktop-packaging/smoke-mac-dmg.mjs <dmg> <evidence-directory>')
const repository = resolve(import.meta.dirname, '..')
const execute = promisify(execFile)
const require = createRequire(join(repository, 'apps/web/package.json'))
const { _electron: electron } = require('playwright')
const yaml = createRequire(join(repository, 'apps/desktop/package.json'))('js-yaml')
const dmg = resolve(process.argv[2])
const evidence = resolve(process.argv[3])
await mkdir(evidence, { recursive: true, mode: 0o700 })

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function processRows() {
  const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,ppid=,command='])
  return stdout.trim().split('\n').map(line => {
    const [, pid, parent, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/u)
    return { pid: Number(pid), parent: Number(parent), command }
  })
}

async function descendants(parent) {
  const rows = await processRows()
  const found = new Set([parent])
  for (let previous = -1; previous !== found.size;) {
    previous = found.size
    for (const row of rows) if (found.has(row.parent)) found.add(row.pid)
  }
  return [...found]
}

function alive(pid) {
  try { process.kill(pid, 0); return true }
  catch (error) { if (error.code === 'ESRCH') return false; throw error }
}

async function waitStopped(pids, timeout) {
  const deadline = Date.now() + timeout
  while (pids.some(alive) && Date.now() < deadline) await delay(100)
  return pids.filter(alive)
}

const manifest = JSON.parse(await readFile(join(dirname(dmg), 'mac-dmg.json'), 'utf8'))
const sourceSha = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim()
assert.equal(manifest.sourceSha, sourceSha, 'DMG source differs from this checkout')
assert.equal(manifest.sha256, await sha256(dmg))
assert.equal(manifest.bytes, (await stat(dmg)).size)
const isolated = await mkdtemp(join(tmpdir(), 'dsh-mac-dmg-'))
const mount = join(isolated, 'mount')
const installed = join(isolated, 'Applications/DeepSeek Harness.app')
const profile = join(isolated, 'dsh-home/profiles/desktop')
const report = { sourceSha, version: manifest.version, dmgSha256: manifest.sha256,
  signature: 'adhoc', notarized: false, mounted: false, copied: false, uiReady: false,
  hostReady: false, exited: false, ownedProcessesStopped: false, pageErrors: [], modelCalls: 0 }
let mounted = false
let application
let ownedPids = []
let exitResult
let cleanupPromise

async function cleanup() {
  return cleanupPromise ??= (async () => {
    if (application) {
      ownedPids = await descendants(application.process().pid)
      await application.close()
      application = undefined
    }
    const remaining = await waitStopped(ownedPids, 15000)
    if (remaining.length) {
      for (const pid of remaining) if (alive(pid)) process.kill(pid, 'SIGTERM')
      const stubborn = await waitStopped(remaining, 5000)
      for (const pid of stubborn) if (alive(pid)) process.kill(pid, 'SIGKILL')
      await waitStopped(stubborn, 5000)
      report.cleanupRequiredTermination = true
    }
    assert.deepEqual(ownedPids.filter(alive), [], 'Owned test processes remain')
    if (mounted) {
      await execute('/usr/bin/hdiutil', ['detach', mount], { timeout: 60000 })
      mounted = false
    }
    await rm(isolated, { recursive: true, force: true })
  })()
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  report.interrupted = signal
  void cleanup().finally(async () => {
    await writeFile(join(evidence, 'smoke-mac-dmg.json'), `${JSON.stringify(report, null, 2)}\n`)
    process.exit(130)
  })
})

try {
  await mkdir(mount)
  await execute('/usr/bin/hdiutil', ['verify', dmg], { timeout: 120000 })
  await execute('/usr/bin/hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-mountpoint', mount], { timeout: 120000 })
  mounted = true
  report.mounted = true
  await mkdir(dirname(installed))
  const mountedApp = join(mount, 'DeepSeek Harness.app')
  await execute('/usr/bin/ditto', [mountedApp, installed], { timeout: 180000 })
  report.appAsarSha256 = await sha256(join(installed, 'Contents/Resources/app.asar'))
  assert.equal(report.appAsarSha256, await sha256(join(mountedApp, 'Contents/Resources/app.asar')))
  assert.equal(await sha256(join(installed, 'Contents/Resources/icon.png')),
    await sha256(join(repository, 'desktop-packaging/icon.png')))
  await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed], { timeout: 120000 })
  const signature = await execute('/usr/bin/codesign', ['--display', '--verbose=4', installed])
  assert(signature.stderr.includes('Signature=adhoc'))
  report.copied = true
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^DSH_|^DEEPSEEK_|^ELECTRON_|^NODE_OPTIONS$|^NODE_PATH$/iu.test(key)))
  application = await electron.launch({
    executablePath: join(installed, 'Contents/MacOS/DeepSeek Harness'),
    args: [`--user-data-dir=${join(isolated, 'electron')}`], cwd: isolated,
    env: { ...env, HOME: isolated, USERPROFILE: isolated, DSH_HOME: join(isolated, 'dsh-home'),
      DSH_TELEMETRY_MODE: 'DISABLED', DSH_TELEMETRY_DISABLED: '1' }, timeout: 120000,
  })
  const child = application.process()
  exitResult = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })))
  const page = await application.firstWindow({ timeout: 120000 })
  page.on('pageerror', error => { report.pageErrors.push(error.message) })
  await page.getByRole('button', { name: /^(New session|新建会话)$/u }).first().waitFor({ timeout: 120000 })
  const actual = await application.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged }))
  assert.equal(actual.version, manifest.version)
  assert.equal(actual.packaged, true)
  assert(page.url().startsWith('dsh-app://app/'))
  assert.deepEqual(JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')).dependencies ?? {}, {})
  const patch = yaml.load(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')) ?? []
  assert(!patch.some(row => row.id === 'webserver'), 'A profile override masks the packaged port default')
  report.uiReady = true
  ownedPids = await descendants(child.pid)
  const host = (await processRows()).find(row => ownedPids.includes(row.pid) && row.command.includes('/dsh-desktop-host/'))
  assert(host, 'Private Desktop Host process was not found')
  const sockets = await execute('/usr/sbin/lsof', ['-nP', '-a', '-p', String(host.pid), '-iTCP', '-sTCP:LISTEN', '-Fn'])
  const addresses = sockets.stdout.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1))
  assert.equal(addresses.length, 1)
  assert(/^127\.0\.0\.1:\d+$/u.test(addresses[0]), 'Host must listen only on IPv4 loopback')
  const port = Number(addresses[0].split(':')[1])
  assert(port > 0 && port !== 19387, 'Host retained the old fixed port')
  const response = await fetch(`http://${addresses[0]}/`, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  assert.equal(response.status, 401)
  await response.arrayBuffer()
  report.hostReady = true
  report.port = port
  await page.screenshot({ path: join(evidence, 'desktop.png') })
  await application.close()
  application = undefined
  const outcome = await exitResult
  assert.deepEqual(outcome, { code: 0, signal: null })
  report.exited = true
  assert.deepEqual(await waitStopped(ownedPids, 15000), [])
  report.ownedProcessesStopped = true
  assert.deepEqual(report.pageErrors, [])
} catch (error) {
  report.error = String(error).replace(/([?&]token=)[^\s&]+/gu, '$1[REDACTED]')
  process.exitCode = 1
} finally {
  try { await cleanup() }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1 }
  await writeFile(join(evidence, 'smoke-mac-dmg.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
}
console.log(JSON.stringify(report))
