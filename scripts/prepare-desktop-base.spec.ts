import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { listOfficialPackageTarballs, officialBuildPhases, prepareDesktopBase } from './prepare-desktop-base.ts'
it('plans one official build and exact package phases with argument vectors', () => {
  const phases = officialBuildPhases('/official source', '/package outputs')
  expect(phases.filter(phase => phase.args.includes('build:official'))).toHaveLength(1)
  expect(phases[0]?.args).toEqual(['install', '--frozen-lockfile'])
  expect(phases).toHaveLength(6)
  expect(phases.flatMap(phase => phase.args)).not.toContain('build')
  expect(phases[2]?.args).toContain('/package outputs/dsh')
})
it('rejects incomplete or unknown CLI input before any build', async () => {
  await expect(prepareDesktopBase([])).rejects.toThrow('--official-source')
  await expect(prepareDesktopBase(['--surprise'])).rejects.toThrow()
})

async function packageDirectory() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-package-outputs-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  for (const family of ['dsh', 'vendor', 'native']) await mkdir(join(root, family))
  return root
}

it.each([false, true])('enumerates only tarballs with release-order sidecars present: %s', async (sidecars) => {
  const root = await packageDirectory()
  const archives = ['dsh/a.tgz', 'dsh/b.tgz', 'vendor/c.tgz', 'native/d.tgz']
  for (const archive of [...archives].reverse()) await writeFile(join(root, archive), 'enumeration fixture')
  if (sidecars) {
    for (const family of ['dsh', 'vendor']) {
      await writeFile(join(root, family, 'publish-order.txt'), '@deepseek-ai/example\n')
    }
  }
  expect(await listOfficialPackageTarballs(root)).toEqual(archives.map(archive => join(root, archive)))
})

it.each([
  { family: 'dsh', name: 'unexpected.txt', kind: 'file' },
  { family: 'vendor', name: 'publish-order.json', kind: 'file' },
  { family: 'native', name: 'publish-order.txt', kind: 'file' },
  { family: 'dsh', name: 'publish-order.txt', kind: 'directory' },
  { family: 'vendor', name: 'publish-order.txt', kind: 'link' },
  { family: 'native', name: 'package.tgz', kind: 'directory' },
  { family: 'dsh', name: 'package.tgz', kind: 'link' },
])('rejects $family/$name when its object is $kind', async ({ family, name, kind }) => {
  const root = await packageDirectory()
  const output = join(root, family, name)
  if (kind === 'directory') await mkdir(output)
  else if (kind === 'link') {
    const target = join(root, 'link-target')
    await mkdir(target)
    await symlink(target, output, 'junction')
  } else await writeFile(output, 'unexpected output')
  await expect(listOfficialPackageTarballs(root)).rejects.toThrow(`Unexpected official package output: ${name}`)
})
