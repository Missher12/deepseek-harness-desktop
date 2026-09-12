import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const source = '5a17c6b29971b6034929bb8a13e3b11cdc4748e8'
const archiveHash = '2974ed04459acaed7dd4b9251efa734d38fc20a6805a4022464f8f4dd2ce2c21'
const executableName = 'DeepSeek-Harness-Setup-0.5.8-win-x64.exe'

/** Refuse another source/run or any replacement of the pinned internal artifact. */
export function verifyMetadata(value) {
  assert.equal(value.id, 10291416609)
  assert.equal(value.name, `DeepSeek-Harness-Setup-win-x64-0.5.8-${source}`)
  assert.equal(value.size_in_bytes, 142093135)
  assert.equal(value.digest, `sha256:${archiveHash}`)
  assert.equal(value.expired, false)
  assert.equal(value.workflow_run.id, 34672172120)
  assert.equal(value.workflow_run.head_sha, source)
}

/** Accept exactly the fixed EXE basename and one LF-terminated checksum. */
export function parseChecksum(text) {
  const match = /^([a-f0-9]{64})  DeepSeek-Harness-Setup-0\.5\.8-win-x64\.exe\n$/.exec(text)
  assert.ok(match, 'Pinned Setup checksum format mismatch')
  return match[1]
}

function download(directory) {
  const endpoint = 'repos/Missher12/deepseek-harness-desktop/actions/artifacts/10291416609'
  const invoke = suffix => execFileSync('gh', ['api', `${endpoint}${suffix}`], {
    maxBuffer: 150_000_000, timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const metadata = JSON.parse(invoke('').toString('utf8'))
  verifyMetadata(metadata)
  const archive = invoke('/zip')
  assert.equal(archive.length, 142093135)
  assert.equal(createHash('sha256').update(archive).digest('hex'), archiveHash)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'candidate.zip'), archive, { flag: 'wx' })
}

function verifyFiles(directory) {
  const diagnosticSourceSha = process.env.DSH_PICKER_DIAGNOSTIC_SHA
  assert.match(diagnosticSourceSha ?? '', /^[a-f0-9]{40}$/)
  assert.notEqual(diagnosticSourceSha, source)
  const executable = join(directory, executableName)
  for (const file of [executable, `${executable}.sha256`]) {
    const stat = lstatSync(file)
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Expected physical candidate file')
  }
  const sha256 = parseChecksum(readFileSync(`${executable}.sha256`, 'utf8'))
  const bytes = readFileSync(executable)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256)
  return { schemaVersion: 1, productSourceSha: source, diagnosticSourceSha, runId: 34672172120, artifactId: 10291416609,
    name: executableName, bytes: bytes.length, sha256, archiveHash, diagnosticOnly: true }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, directory] = process.argv.slice(2)
    assert.ok(directory)
    if (mode === 'download') download(directory)
    else {
      assert.equal(mode, 'verify')
      process.stdout.write(JSON.stringify(verifyFiles(directory)) + '\n')
    }
  } catch {
    // gh errors can contain signed redirect URLs; retain no raw subprocess output.
    process.stderr.write('Pinned diagnostic artifact verification failed.\n')
    process.exitCode = 1
  }
}
