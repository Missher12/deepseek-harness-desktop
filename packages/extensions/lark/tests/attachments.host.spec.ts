import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import {
  AttachmentId,
  type ImageAttachmentRef,
  type SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { LarkAttachmentService, type StagedFileStore } from '../src/attachments.ts'
import type { StagedFileRecord } from '../src/state.ts'

describe('Lark attachment boundaries', () => {
  test('routes images through the Harness AttachmentStore', async () => {
    const saveImages = vi.fn(async (
      inputs: readonly SaveImageAttachment[],
    ): Promise<readonly ImageAttachmentRef[]> => inputs.map((_input, index) => ({
      attachmentId: AttachmentId(`a${index}`), mediaType: 'image/png', bytes: 4, width: 1, height: 1,
    })))
    const service = new LarkAttachmentService({
      imageStore: { saveImages }, stagingRoot: '/unused', files: memoryFiles(),
    })
    await expect(service.saveImages([
      { data: new Uint8Array([1, 2, 3, 4]), mediaType: 'image/png', name: 'image.png' },
    ])).resolves.toEqual([expect.objectContaining({ attachmentId: 'a0' })])
    expect(saveImages).toHaveBeenCalledOnce()
  })

  test('stages generic files privately outside the project with bounded size and safe names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-files-'))
    const files = memoryFiles()
    const service = new LarkAttachmentService({
      imageStore: { saveImages: vi.fn() }, stagingRoot: root, files,
      maxBytes: 16, now: () => 1000, id: () => 'file-id', retentionMs: 500,
    })
    const record = await service.stageFile({ name: '../../project.env', data: new TextEncoder().encode('safe') })
    expect(record.path.startsWith(root)).toBe(true)
    expect(record.path).not.toContain('project.env')
    expect(await readFile(record.path, 'utf8')).toBe('safe')
    expect((await stat(record.path)).mode & 0o077).toBe(0)
    await expect(service.stageFile({ name: 'large.bin', data: new Uint8Array(17) })).rejects.toThrow(/30 MiB|limit/)
  })

  test('cleans only expired, root-owned staged files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lark-clean-'))
    const files = memoryFiles()
    let now = 1000
    const service = new LarkAttachmentService({
      imageStore: { saveImages: vi.fn() }, stagingRoot: root, files,
      now: () => now, id: () => 'file-id', retentionMs: 100,
    })
    const record = await service.stageFile({ name: 'file.bin', data: new Uint8Array([1]) })
    now = 1200
    await service.cleanup()
    await expect(stat(record.path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await files.list()).toEqual([])
  })
})

function memoryFiles(): StagedFileStore {
  const records = new Map<string, StagedFileRecord>()
  return {
    list: async () => [...records.values()],
    put: async (record) => { records.set(record.id, record) },
    delete: async (id) => { records.delete(id) },
  }
}
