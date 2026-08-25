import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { StagedFileRecord } from './state.ts'
import { DEFAULT_FILE_RETENTION_MS, DEFAULT_MAX_MEDIA_BYTES } from './config.ts'

export interface StagedFileStore {
  list(): Promise<StagedFileRecord[]>
  put(record: StagedFileRecord): Promise<void>
  delete(id: string): Promise<void>
}

interface AttachmentOptions {
  imageStore: { saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> }
  stagingRoot: string
  files: StagedFileStore
  maxBytes?: number
  retentionMs?: number
  now?: () => number
  id?: () => string
}

/** Harness images plus private, expiring staging for non-image Feishu files. */
export class LarkAttachmentService {
  private readonly root: string
  private readonly maxBytes: number
  private readonly retentionMs: number
  private readonly now: () => number
  private readonly id: () => string

  constructor(private readonly options: AttachmentOptions) {
    this.root = resolve(options.stagingRoot)
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_MEDIA_BYTES
    this.retentionMs = options.retentionMs ?? DEFAULT_FILE_RETENTION_MS
    this.now = options.now ?? Date.now
    this.id = options.id ?? randomUUID
  }

  saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    return this.options.imageStore.saveImages(inputs)
  }

  async stageFile(input: { name: string; data: Uint8Array }): Promise<StagedFileRecord> {
    if (input.data.byteLength > this.maxBytes) throw new Error('Lark file exceeds the configured 30 MiB limit')
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const id = this.id()
    const finalPath = join(this.root, `${id}.bin`)
    const temporaryPath = join(this.root, `.${id}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporaryPath, input.data, { flag: 'wx', mode: 0o600 })
      await rename(temporaryPath, finalPath)
    } catch (error) {
      await unlink(temporaryPath).catch(() => {})
      throw error
    }
    const now = this.now()
    const record: StagedFileRecord = {
      id,
      path: finalPath,
      name: basename(input.name).slice(0, 512) || 'file',
      size: input.data.byteLength,
      sha256: createHash('sha256').update(input.data).digest('hex'),
      createdAt: now,
      expiresAt: now + this.retentionMs,
    }
    try {
      await this.options.files.put(record)
      return record
    } catch (error) {
      await unlink(finalPath).catch(() => {})
      throw error
    }
  }

  async cleanup(): Promise<number> {
    let removed = 0
    for (const record of await this.options.files.list()) {
      if (record.expiresAt > this.now() || !this.owns(record.path)) continue
      await unlink(record.path).catch((error: unknown) => {
        if (!isMissing(error)) throw error
      })
      await this.options.files.delete(record.id)
      removed += 1
    }
    return removed
  }

  async clear(): Promise<number> {
    let removed = 0
    for (const record of await this.options.files.list()) {
      if (!this.owns(record.path)) continue
      await unlink(record.path).catch((error: unknown) => {
        if (!isMissing(error)) throw error
      })
      await this.options.files.delete(record.id)
      removed += 1
    }
    return removed
  }

  private owns(path: string): boolean {
    const candidate = resolve(path)
    const child = relative(this.root, candidate)
    return child.length > 0 && !child.startsWith('..') && !isAbsolute(child)
  }
}

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
