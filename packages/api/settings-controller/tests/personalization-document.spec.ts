import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_PERSONALIZATION_INSTRUCTIONS_BYTES,
  PersonalizationDocumentError,
  readPersonalizationDocument,
  writePersonalizationDocument,
} from '../src/personalization-document.ts'

const roots: string[] = []
const START = '<!-- dsh-desktop:personalization:start -->'
const END = '<!-- dsh-desktop:personalization:end -->'
const STYLE = '<!-- dsh-desktop:reply-style:default -->'
const INSTRUCTIONS_START = '<!-- dsh-desktop:instructions:start -->'
const INSTRUCTIONS_END = '<!-- dsh-desktop:instructions:end -->'

async function target(): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-personalization-'))
  roots.push(root)
  return { root, path: join(root, 'home', 'AGENTS.md') }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('settings-owned personalization document', () => {
  it('describes an absent canonical document without creating it', async () => {
    const { path } = await target()
    await expect(readPersonalizationDocument(path)).resolves.toMatchObject({
      instructions: '',
      style: 'default',
      hasExternalContent: false,
      writable: true,
    })
    expect((await readPersonalizationDocument(path)).revision).toMatch(/^[a-f0-9]{64}$/)
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('round-trips one managed block atomically with private permissions', async () => {
    const { root, path } = await target()
    const before = await readPersonalizationDocument(path)
    const written = await writePersonalizationDocument(path, {
      instructions: '请优先给出可以直接执行的结论。',
      style: 'friendly',
      expectedRevision: before.revision,
    })

    expect(written).toMatchObject({
      instructions: '请优先给出可以直接执行的结论。',
      style: 'friendly',
      writable: true,
    })
    const raw = await readFile(path, 'utf8')
    expect(raw).toContain('<!-- dsh-desktop:personalization:start -->')
    expect(raw).toContain('请优先给出可以直接执行的结论。')
    expect(raw).toContain('Use a warm, friendly tone')
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    }
    expect(await readdir(join(root, 'home'))).toEqual(['AGENTS.md'])
  })

  it('preserves manual bytes exactly when replacing and removing its block', async () => {
    const { path } = await target()
    const manual = Buffer.from('# Manual\n\n保留这些内容。\n')
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, manual)
    const first = await readPersonalizationDocument(path)
    expect(first.hasExternalContent).toBe(true)
    const saved = await writePersonalizationDocument(path, {
      instructions: 'Use tests first.',
      style: 'concise',
      expectedRevision: first.revision,
    })
    const cleared = await writePersonalizationDocument(path, {
      instructions: '',
      style: 'default',
      expectedRevision: saved.revision,
    })

    expect(cleared.hasExternalContent).toBe(true)
    expect(await readFile(path)).toEqual(manual)
  })

  it('rejects stale, NUL, marker, and over-limit writes', async () => {
    const { path } = await target()
    const before = await readPersonalizationDocument(path)
    await writePersonalizationDocument(path, {
      instructions: 'first', style: 'default', expectedRevision: before.revision,
    })
    await expect(writePersonalizationDocument(path, {
      instructions: 'stale', style: 'default', expectedRevision: before.revision,
    })).rejects.toMatchObject({ code: 'conflict' })
    await expect(writePersonalizationDocument(path, {
      instructions: 'bad\0value', style: 'default', expectedRevision: (await readPersonalizationDocument(path)).revision,
    })).rejects.toBeInstanceOf(PersonalizationDocumentError)
    await expect(writePersonalizationDocument(path, {
      instructions: '<!-- dsh-desktop:personalization:end -->',
      style: 'default', expectedRevision: (await readPersonalizationDocument(path)).revision,
    })).rejects.toMatchObject({ code: 'invalid' })
    await expect(writePersonalizationDocument(path, {
      instructions: '界'.repeat(MAX_PERSONALIZATION_INSTRUCTIONS_BYTES),
      style: 'default', expectedRevision: (await readPersonalizationDocument(path)).revision,
    })).rejects.toMatchObject({ code: 'invalid' })
    await expect(writePersonalizationDocument(path, {
      instructions: '', style: 'unsupported' as never,
      expectedRevision: (await readPersonalizationDocument(path)).revision,
    })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('never follows a final-component symlink', async () => {
    const { root, path } = await target()
    const external = join(root, 'external.md')
    await mkdir(join(root, 'home'), { recursive: true })
    await writeFile(external, 'external secret')
    await symlink(external, path)

    const view = await readPersonalizationDocument(path)
    expect(view).toMatchObject({ writable: false, instructions: '', hasExternalContent: true })
    await expect(writePersonalizationDocument(path, {
      instructions: 'replace', style: 'default', expectedRevision: view.revision,
    })).rejects.toMatchObject({ code: 'read-only' })
    expect(await readFile(external, 'utf8')).toBe('external secret')
  })

  it('treats directories and malformed ownership markers as read-only', async () => {
    const { root, path } = await target()
    await mkdir(path, { recursive: true })
    await expect(readPersonalizationDocument(path)).resolves.toMatchObject({
      writable: false, hasExternalContent: true,
    })

    await rm(path, { recursive: true })
    await mkdir(join(root, 'home'), { recursive: true })
    const malformed = [
      END,
      START,
      `${START}\n${END}\n${START}`,
      `${START}\n${END}\n${END}`,
      `${END}\n${START}`,
    ]
    for (const raw of malformed) {
      await writeFile(path, raw)
      await expect(readPersonalizationDocument(path)).resolves.toMatchObject({
        writable: false, hasExternalContent: true,
      })
    }
  })

  it('rejects malformed managed content without exposing partial instructions', async () => {
    const { path } = await target()
    await mkdir(join(path, '..'), { recursive: true })
    const malformed = [
      Buffer.concat([Buffer.from(`${START}\n${STYLE}\n`), Buffer.from([0xff]), Buffer.from(`\n${END}`)]),
      Buffer.from(`${START}\n${INSTRUCTIONS_START}\ntext\n${INSTRUCTIONS_END}\n${END}`),
      Buffer.from(`${START}\n${STYLE}\n${INSTRUCTIONS_END}\n${INSTRUCTIONS_START}\n${END}`),
      Buffer.from(`${START}\n${STYLE}\n${INSTRUCTIONS_START}\ntext\n${END}`),
    ]
    for (const raw of malformed) {
      await writeFile(path, raw)
      await expect(readPersonalizationDocument(path)).resolves.toMatchObject({
        instructions: '', style: 'default', writable: false, hasExternalContent: true,
      })
    }
  })

  it('parses a valid compact block without requiring surrounding instruction newlines', async () => {
    const { path } = await target()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, `${START}\n${STYLE}\n${INSTRUCTIONS_START}compact${INSTRUCTIONS_END}\n${END}`)

    await expect(readPersonalizationDocument(path)).resolves.toMatchObject({
      instructions: 'compact', style: 'default', writable: true, hasExternalContent: false,
    })
  })

  it('returns the unchanged absent document for an empty default write', async () => {
    const { path } = await target()
    const before = await readPersonalizationDocument(path)

    await expect(writePersonalizationDocument(path, {
      instructions: '', style: 'default', expectedRevision: before.revision,
    })).resolves.toEqual(before)
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('propagates non-ENOENT filesystem lookup errors', async () => {
    await expect(readPersonalizationDocument('bad\0path')).rejects.toThrow()
  })
})
