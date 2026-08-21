import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listWorkspace, readWorkspaceFile } from '../src/files.ts'
import { MAX_PREVIEW_BYTES } from '../src/protocol.ts'
import { gitDiff, gitStatus } from '../src/review.ts'

describe('read-only workbench data sources', () => {
  it('filters hidden files and bounds previews', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-files-'))
    await mkdir(join(root, 'folder'))
    await writeFile(join(root, '.secret'), 'hidden')
    await writeFile(join(root, 'large.txt'), 'x'.repeat(MAX_PREVIEW_BYTES + 10))
    const listing = await listWorkspace(root)
    expect(listing.entries.map(entry => entry.name)).toEqual(['folder', 'large.txt'])
    const preview = await readWorkspaceFile(root, 'large.txt')
    expect(preview.text).toHaveLength(MAX_PREVIEW_BYTES)
    expect(preview.truncated).toBe(true)
  })

  it('reports Git changes and permits a deleted path diff', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-review-'))
    const run = async (...args: string[]) => {
      const { execFile } = await import('node:child_process')
      await new Promise<void>((resolve, reject) => {
        execFile('git', ['-C', root, ...args], (error) => {
          if (error === null) resolve()
          else reject(new Error(error.message, { cause: error }))
        })
      })
    }
    await run('init')
    await run('config', 'user.email', 'test@example.invalid')
    await run('config', 'user.name', 'Test')
    await writeFile(join(root, 'gone.txt'), 'before\n')
    await run('add', 'gone.txt')
    await run('commit', '-m', 'initial')
    const { unlink } = await import('node:fs/promises')
    await unlink(join(root, 'gone.txt'))
    expect((await gitStatus(root)).entries).toContainEqual({ status: ' D', path: 'gone.txt' })
    expect((await gitDiff(root, 'gone.txt')).text).toContain('-before')
  })

  it('renders a non-Git workspace as an empty review instead of an HTTP error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-review-non-git-'))
    await expect(gitStatus(root)).resolves.toEqual({ entries: [], truncated: false })
  })
})
