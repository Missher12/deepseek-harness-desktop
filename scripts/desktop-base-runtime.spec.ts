import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { recordOfficialRuntime, verifyOfficialRuntime } from './desktop-base-runtime.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-base-runtime-')); roots.push(root)
  await mkdir(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
  await writeFile(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.5-rc.2' }))
  await writeFile(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), 'export {}\n')
  return root
}
const origin = { sourceSha: 'fb2c4b9e698e30edb738bca4cf0618587db7d203', harnessVersion: '0.1.5-rc.2' }

describe('official runtime provenance', () => {
  it('binds actual runtime bytes to the official source and detects later mutation', async () => {
    const root = await fixture()
    const receipt = await recordOfficialRuntime(root, origin)
    expect(receipt.files.length).toBeGreaterThan(0)
    await expect(verifyOfficialRuntime(root)).resolves.toMatchObject(origin)
    await writeFile(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), 'changed\n')
    await expect(verifyOfficialRuntime(root)).rejects.toThrow(/hash|bytes/iu)
  })
  it('rejects a same-version fork source', async () => {
    const root = await fixture()
    await expect(recordOfficialRuntime(root, { ...origin, sourceSha: 'd1e8bd9c6d49f980405888099087f931ddd26d83' })).rejects.toThrow(/official/iu)
  })
  it('rejects files added after the provenance was recorded', async () => {
    const root = await fixture(); await recordOfficialRuntime(root, origin)
    await writeFile(join(root, 'unexpected.js'), 'export {}\n')
    await expect(verifyOfficialRuntime(root)).rejects.toThrow(/inventory/iu)
  })
  it('rejects a link outside the runtime and preserves the target', async () => {
    const root = await fixture(); const outside = await fixture()
    const path = join(outside, 'protected.txt'); await writeFile(path, 'keep')
    await symlink(path, join(root, 'escape'))
    await expect(recordOfficialRuntime(root, origin)).rejects.toThrow(/outside/iu)
    expect(await readFile(path, 'utf8')).toBe('keep')
  })
})
