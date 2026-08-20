import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveOptionalWorkspacePath, resolveWorkspacePath } from '../src/workspace-path.ts'

describe('resolveWorkspacePath', () => {
  it('accepts children and rejects traversal and symlink escape', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-workbench-'))
    const root = join(base, 'root')
    const outside = join(base, 'outside')
    await mkdir(root)
    await mkdir(outside)
    await writeFile(join(root, 'inside.txt'), 'ok')
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(outside, join(root, 'linked-outside'))
    await expect(resolveWorkspacePath(root, 'inside.txt')).resolves.toBe(await realpath(join(root, 'inside.txt')))
    await expect(resolveWorkspacePath(root, '../outside/secret.txt')).rejects.toThrow(/outside workspace/)
    await expect(resolveWorkspacePath(root, 'linked-outside/secret.txt')).rejects.toThrow(/outside workspace/)
    await expect(resolveOptionalWorkspacePath(root, 'deleted.txt')).resolves.toBe(join(await realpath(root), 'deleted.txt'))
    await expect(resolveOptionalWorkspacePath(root, '../outside/deleted.txt')).rejects.toThrow(/outside workspace/)
  })
})
