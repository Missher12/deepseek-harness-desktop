import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDesktopCandidateDescriptor,
  verifyDesktopCandidateDescriptor,
} from './desktop-candidate-descriptor.ts'

const roots: string[] = []
const sourceSha = 'a'.repeat(40)

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async root => rm(root, { force: true, recursive: true })))
})

async function fixture(): Promise<{
  artifactPath: string
  descriptorPath: string
  productInputPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-candidate-descriptor-'))
  roots.push(root)
  const artifactPath = join(root, 'DeepSeek-Harness-Setup-0.5.2-win-x64.exe')
  const productInputPath = join(root, 'desktop-package-staged.json')
  const descriptorPath = join(root, 'desktop-candidate.json')
  await writeFile(artifactPath, 'setup-bytes')
  await writeFile(productInputPath, '{"schemaVersion":1}\n')
  return { artifactPath, descriptorPath, productInputPath }
}

describe('Desktop candidate descriptor', () => {
  it('creates a portable descriptor bound to the artifact and product input bytes', async () => {
    const paths = await fixture()

    const descriptor = await createDesktopCandidateDescriptor({
      ...paths,
      sourceSha,
      platform: 'win-x64',
      mode: 'quick',
    })

    expect(descriptor).toEqual({
      schemaVersion: 1,
      sourceSha,
      platform: 'win-x64',
      mode: 'quick',
      artifact: {
        basename: 'DeepSeek-Harness-Setup-0.5.2-win-x64.exe',
        bytes: 11,
        sha256: createHash('sha256').update('setup-bytes').digest('hex'),
      },
      productInputSha256: createHash('sha256').update('{"schemaVersion":1}\n').digest('hex'),
    })
    expect(JSON.parse(await readFile(paths.descriptorPath, 'utf8'))).toEqual(descriptor)
    expect(await readFile(paths.descriptorPath, 'utf8')).toMatch(/\n$/u)
    expect(JSON.stringify(descriptor)).not.toContain(paths.artifactPath)
  })

  it('verifies the exact source, platform, mode, basename, bytes, and SHA-256', async () => {
    const paths = await fixture()
    const created = await createDesktopCandidateDescriptor({
      ...paths,
      sourceSha,
      platform: 'win-x64',
      mode: 'full',
    })

    await expect(verifyDesktopCandidateDescriptor({
      artifactPath: paths.artifactPath,
      descriptorPath: paths.descriptorPath,
      sourceSha,
      platform: 'win-x64',
      mode: 'full',
    })).resolves.toEqual(created)

    await writeFile(paths.artifactPath, 'changed-setup-bytes')
    await expect(verifyDesktopCandidateDescriptor({
      artifactPath: paths.artifactPath,
      descriptorPath: paths.descriptorPath,
      sourceSha,
      platform: 'win-x64',
      mode: 'full',
    })).rejects.toThrow(/artifact byte length mismatch/u)

    await writeFile(paths.artifactPath, 'other-bytes')
    await expect(verifyDesktopCandidateDescriptor({
      artifactPath: paths.artifactPath,
      descriptorPath: paths.descriptorPath,
      sourceSha,
      platform: 'win-x64',
      mode: 'full',
    })).rejects.toThrow(/artifact SHA-256 mismatch/u)
  })

  it('rejects source, platform, and mode mismatches before trusting the artifact', async () => {
    const paths = await fixture()
    await createDesktopCandidateDescriptor({
      ...paths,
      sourceSha,
      platform: 'win-x64',
      mode: 'quick',
    })

    for (const expected of [
      { sourceSha: 'b'.repeat(40), platform: 'win-x64', mode: 'quick' },
      { sourceSha, platform: 'mac-x64', mode: 'quick' },
      { sourceSha, platform: 'win-x64', mode: 'full' },
    ] as const) {
      await expect(verifyDesktopCandidateDescriptor({
        artifactPath: paths.artifactPath,
        descriptorPath: paths.descriptorPath,
        ...expected,
      })).rejects.toThrow(/candidate (?:source|platform|mode) mismatch/u)
    }
  })

  it('rejects unknown keys, non-basename paths, invalid hashes, and unsafe byte counts', async () => {
    const paths = await fixture()
    const valid = await createDesktopCandidateDescriptor({
      ...paths,
      sourceSha,
      platform: 'win-x64',
      mode: 'quick',
    })
    const invalid = [
      { ...valid, unexpected: true },
      { ...valid, artifact: { ...valid.artifact, unexpected: true } },
      { ...valid, artifact: { ...valid.artifact, basename: '../setup.exe' } },
      { ...valid, artifact: { ...valid.artifact, basename: '/tmp/setup.exe' } },
      { ...valid, artifact: { ...valid.artifact, basename: 'C:\\temp\\setup.exe' } },
      { ...valid, artifact: { ...valid.artifact, sha256: valid.artifact.sha256.toUpperCase() } },
      { ...valid, productInputSha256: valid.productInputSha256.toUpperCase() },
      { ...valid, artifact: { ...valid.artifact, bytes: -1 } },
    ]

    for (const document of invalid) {
      await writeFile(paths.descriptorPath, `${JSON.stringify(document)}\n`)
      await expect(verifyDesktopCandidateDescriptor({
        artifactPath: paths.artifactPath,
        descriptorPath: paths.descriptorPath,
        sourceSha,
        platform: 'win-x64',
        mode: 'quick',
      })).rejects.toThrow(/Desktop candidate descriptor/u)
    }
  })
})
