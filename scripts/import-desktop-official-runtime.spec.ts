import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { recordOfficialRuntime } from './desktop-base-runtime.ts'
import { importOfficialRuntime } from './import-desktop-official-runtime.ts'
import type { VerifiedOfficialInputs } from './desktop-official-inputs.ts'
const roots: string[] = []
const hash = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex')
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(platform = process.platform): Promise<{
  root: string
  runtime: string
  audit: string
  digest: string
  inputs: VerifiedOfficialInputs
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-import-')); roots.push(root)
  const runtime = join(root, 'runtime'); await mkdir(runtime); await writeFile(join(runtime, 'runtime.js'), 'export {}\n')
  const source = { sourceSha: 'fb2c4b9e698e30edb738bca4cf0618587db7d203', harnessVersion: '0.1.5-rc.2' }
  const provenance = await recordOfficialRuntime(runtime, source)
  const evidence = join(root, 'native.json'); await writeFile(evidence, '{"fixture":true}\n')
  const inputs = { source, descriptorSha256: 'a'.repeat(64) } as VerifiedOfficialInputs
  const audit = join(root, 'audit.json')
  const bytes = JSON.stringify({ schema: 1, sourceSha: source.sourceSha, inputManifestSha256: inputs.descriptorSha256,
    runtimeInventorySha256: provenance.inventorySha256, platform, arch: process.arch,
    evidence: [{ path: evidence, sha256: hash(await readFile(evidence)) }],
  })
  await writeFile(audit, bytes)
  return { root, runtime, audit, digest: hash(bytes), inputs }
}
it('reuses audited native bytes without writing inside the old runtime', async () => {
  const f = await fixture(); const before = await readFile(join(f.runtime, 'provenance.json'))
  await expect(importOfficialRuntime(f.inputs, f.runtime, f.audit, f.digest)).resolves.toMatchObject({ platform: process.platform })
  expect(await readFile(join(f.runtime, 'provenance.json'))).toEqual(before)
})
it('rejects a different platform even with a matching audit digest', async () => {
  const f = await fixture(process.platform === 'win32' ? 'darwin' : 'win32')
  await expect(importOfficialRuntime(f.inputs, f.runtime, f.audit, f.digest)).rejects.toThrow('native platform')
})
it('rejects changed runtime, evidence, and untrusted audit bytes', async () => {
  const f = await fixture()
  await expect(importOfficialRuntime(f.inputs, f.runtime, f.audit, 'b'.repeat(64))).rejects.toThrow('receipt hash')
  await writeFile(join(f.root, 'native.json'), 'changed')
  await expect(importOfficialRuntime(f.inputs, f.runtime, f.audit, f.digest)).rejects.toThrow('evidence hash')
  const second = await fixture(); await writeFile(join(second.runtime, 'runtime.js'), 'changed')
  await expect(importOfficialRuntime(second.inputs, second.runtime, second.audit, second.digest)).rejects.toThrow(/hash|bytes/iu)
})
