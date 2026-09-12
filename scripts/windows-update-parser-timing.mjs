import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

const productSourceSha = '2106cb68aa5b467dc3a7dc3a225027af08142222'
const pins = {
  'apps/desktop/tests/windows-update-installer.spec.ts': '3fa3b48bd6925b0706c39f5fb3010cbf732ba63b01b3a3d4a6fea94f9b78c1e8',
  'apps/desktop/src/update/windows-installer.ts': 'd86db87ba2c772abac6ecfe47f2cf1eef840eb63a013c561dccfd465d3f59a0c',
  'apps/desktop/src/update/release.ts': '6b647a281b16810a57b8ec0a25379c4d00d4d9c168a650c41bd217733b6ccaa3',
  'apps/desktop/src/update/verification.ts': 'bb14393348e5e7ee20889d7d8ce36a3578c2f58bc5e724452c80f8b943486718',
  'apps/desktop/src/update/windows-signal.ts': '2b3099c82eb7adb10c84f181a4f7cdf54579fed9f9d5f7f3a983919c81cfb6df',
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const elapsed = since => Number((performance.now() - since).toFixed(3))

function decode(stdout) {
  const lines = stdout.trim().split(/\r?\n/)
  assert.equal(lines.length, 5)
  const first = /^DSH_START ([1-9]\d*) (\d+) (\d+\.\d+) (\d{4}-\d\d-\d\dT[\d:.]+Z)$/.exec(lines[0])
  assert.ok(first)
  const counts = [], parseMs = []
  for (const [index, name] of ['bootstrap', 'worker'].entries()) {
    const count = new RegExp(`^DSH_PARSE ${name}\\.ps1 (\\d+)$`).exec(lines[1 + index * 2])
    const time = new RegExp(`^DSH_TIME ${name}\\.ps1 (\\d+\\.\\d+)$`).exec(lines[2 + index * 2])
    assert.ok(count && time)
    counts.push([name, count[1]])
    parseMs.push(Number(time[1]))
  }
  return { pid: Number(first[1]), startedTicks: first[2], firstStatementMs: Number(first[3]), firstStatementUtc: first[4], counts, parseMs }
}

async function fixture() {
  for (const [file, expected] of Object.entries(pins)) {
    const info = lstatSync(file)
    assert.ok(info.isFile() && !info.isSymbolicLink())
    assert.equal(digest(readFileSync(file)), expected, `Pinned input mismatch: ${basename(file)}`)
  }
  const { createWindowsUpdateCommand } = await import(pathToFileURL(resolve('apps/desktop/src/update/windows-installer.ts')).href)
  const spec = readFileSync('apps/desktop/tests/windows-update-installer.spec.ts', 'utf8')
  // Reuse the exact pinned descriptor, signal and command fixture rather than copying their values.
  const start = spec.indexOf('const descriptor = {')
  const end = spec.indexOf('\ndescribe(', start)
  assert.ok(start >= 0 && end > start)
  const command = runInNewContext(stripTypeScriptTypes(spec.slice(start, end)) + '\ncommand', { createWindowsUpdateCommand }, { timeout: 1000 })
  const plan = command(process.env)
  const source = Buffer.from(plan.args.at(-1), 'base64').toString('utf16le')
  const marker = "$workerScript = @'\n"
  const workerStart = source.indexOf(marker)
  assert.ok(workerStart >= 0)
  const workerEnd = source.indexOf("\n'@", workerStart + marker.length)
  assert.ok(workerEnd > workerStart)
  return { plan, source, worker: source.slice(workerStart + marker.length, workerEnd) }
}

const parser = String.raw`
$firstStatement = [DateTime]::UtcNow
$ErrorActionPreference='Stop'
$self=[Diagnostics.Process]::GetCurrentProcess()
try {
  $started=$self.StartTime.ToUniversalTime()
  $firstMs=($firstStatement-$started).TotalMilliseconds.ToString('F3',[Globalization.CultureInfo]::InvariantCulture)
  [Console]::Out.WriteLine(('DSH_START {0} {1} {2} {3}' -f $PID,$started.Ticks,$firstMs,$firstStatement.ToString('o')))
} finally { $self.Dispose() }
$failed=$false
foreach($name in @('bootstrap.ps1','worker.ps1')) {
  $tokens=$null; $errors=$null
  $watch=[Diagnostics.Stopwatch]::StartNew()
  [void][System.Management.Automation.Language.Parser]::ParseFile([IO.Path]::Combine($env:DSH_PARSER_ROOT,$name),[ref]$tokens,[ref]$errors)
  $watch.Stop()
  [Console]::Out.WriteLine(('DSH_PARSE {0} {1}' -f $name,@($errors).Count))
  [Console]::Out.WriteLine(('DSH_TIME {0} {1}' -f $name,$watch.Elapsed.TotalMilliseconds.ToString('F3',[Globalization.CultureInfo]::InvariantCulture)))
  if(@($errors).Count -gt 0){$failed=$true}
}
if($failed){exit 1}
`

function exited(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  try { process.kill(pid, 0); return false }
  catch (error) { if (error.code === 'ESRCH') return true; return null }
}

async function measure() {
  const started = performance.now()
  const report = { schemaVersion: 1, productSourceSha, diagnosticSourceSha: process.env.GITHUB_SHA ?? null,
    diagnosticOnly: true, totalBudgetMs: 30_000, childTimeoutMs: 10_000,
    pins: Object.fromEntries(Object.entries(pins).map(([path, hash]) => [basename(path), hash])),
    phase: 'inputs', timingsMs: {}, cases: [], firstErrorType: null, directoryRemoved: null }
  const root = process.env.DSH_PARSER_TIMING_ROOT
  assert.equal(process.platform, 'win32')
  assert.ok(root && /^dsh-parser-timing-[a-f0-9]{32}$/.test(basename(root)))
  assert.equal((await realpath(dirname(root))).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
  assert.ok(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink())
  const directory = join(await realpath(root), 'case')
  const output = resolve('apps/desktop/release/windows-parser-timing.json')
  await mkdir(dirname(output), { recursive: true })
  const save = async () => {
    // The Windows checkout and TEMP may be on different volumes; publish on the output volume.
    const temporary = join(dirname(output), `.parser-${randomBytes(8).toString('hex')}.tmp`)
    await writeFile(temporary, JSON.stringify(report) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temporary, output)
  }
  try {
    const prepared = performance.now()
    const { plan, source, worker } = await fixture()
    report.timingsMs.inputPreparation = elapsed(prepared)
    report.generated = { bootstrapSha256: digest(source), workerSha256: digest(worker) }
    report.phase = 'files'
    const files = performance.now()
    await mkdir(directory, { mode: 0o700 })
    await writeFile(join(directory, 'bootstrap.ps1'), source, { flag: 'wx', mode: 0o600 })
    await writeFile(join(directory, 'worker.ps1'), worker, { flag: 'wx', mode: 0o600 })
    report.timingsMs.filePreparation = elapsed(files)
    await save()
    for (const kind of ['valid', 'invalid-worker']) {
      if (kind === 'invalid-worker') {
        const mutation = performance.now()
        await writeFile(join(directory, 'worker.ps1'), ')')
        report.timingsMs.corruptWorker = elapsed(mutation)
      }
      assert.ok(elapsed(started) < 19_000, 'Insufficient remaining diagnostic budget for an unchanged 10s child')
      report.phase = kind
      await save()
      const before = performance.now()
      const result = spawnSync(plan.executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(parser, 'utf16le').toString('base64')], {
        stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: false, windowsHide: true,
        timeout: 10_000, maxBuffer: 1024, env: { ...plan.env, DSH_PARSER_ROOT: directory },
      })
      const item = { kind, wallMs: elapsed(before), status: result.status, signal: result.signal,
        errorCode: result.error === undefined ? null : typeof result.error.code === 'string' ? result.error.code : 'UNKNOWN',
        stderrBytes: Buffer.byteLength(result.stderr ?? ''),
        pid: result.pid ?? null, processExited: exited(result.pid), records: null, recordError: null }
      try { item.records = decode(result.stdout ?? '') } catch { item.recordError = 'InvalidTimingRecords' }
      report.cases.push(item)
      await save()
      assert.equal(item.errorCode, null)
      assert.equal(item.signal, null)
      assert.equal(item.stderrBytes, 0)
      assert.equal(item.processExited, true)
      assert.equal(item.recordError, null)
      assert.equal(item.records.pid, item.pid)
      if (kind === 'valid') {
        assert.equal(item.status, 0)
        assert.deepEqual(item.records.counts, [['bootstrap', '0'], ['worker', '0']])
      } else {
        assert.equal(item.status, 1)
        assert.deepEqual(item.records.counts[0], ['bootstrap', '0'])
        assert.equal(item.records.counts[1][0], 'worker')
        assert.ok(Number(item.records.counts[1][1]) > 0)
      }
    }
    report.phase = 'complete'
  } catch (error) { report.firstErrorType = error instanceof Error ? error.name : 'UnknownError' }
  finally {
    const cleanup = performance.now()
    try { await rm(directory, { recursive: true, force: true }); report.directoryRemoved = !existsSync(directory) }
    catch (error) { report.cleanupErrorType = error instanceof Error ? error.name : 'UnknownError' }
    report.timingsMs.cleanup = elapsed(cleanup)
    report.timingsMs.total = elapsed(started)
    await save()
  }
  assert.ok(report.phase === 'complete' && report.firstErrorType === null && report.directoryRemoved === true && report.timingsMs.total < 30_000, 'Native parser timing did not complete within its diagnostic limits')
}

function checkDecoder() {
  assert.equal(typeof decode, 'function')
  const sample = 'DSH_START 123 638000000000000000 1250.500 2026-09-12T07:00:00.0000000Z\nDSH_PARSE bootstrap.ps1 0\nDSH_TIME bootstrap.ps1 2.500\nDSH_PARSE worker.ps1 1\nDSH_TIME worker.ps1 3.250\n'
  const result = decode(sample)
  assert.equal(result.firstStatementMs, 1250.5)
  assert.deepEqual(result.counts, [['bootstrap', '0'], ['worker', '1']])
  assert.deepEqual(result.parseMs, [2.5, 3.25])
  assert.throws(() => decode(sample.replace('DSH_TIME worker.ps1 3.250', 'DSH_TIME worker.ps1 NaN')))
  assert.throws(() => decode(sample + 'uncontrolled output\n'))
  assert.throws(() => decode(sample.replace('DSH_PARSE worker.ps1 1', 'DSH_PARSE foreign.ps1 1')))
}

try {
  checkDecoder()
  if (process.argv.includes('--check')) {
    const value = await fixture()
    console.log(JSON.stringify({ check: 'passed', pinnedFiles: Object.keys(pins).length,
      bootstrapSha256: digest(value.source), workerSha256: digest(value.worker), nativeExecuted: false }))
  } else await measure()
} catch (error) {
  // No exception message, stack, source, path or environment is released.
  console.error(JSON.stringify({ diagnosticErrorType: error instanceof Error ? error.name : 'UnknownError' }))
  process.exitCode = 1
}
