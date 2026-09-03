/**
 * Fixed-file storage for the Desktop-owned personalization block in the
 * canonical global AGENTS.md. The Settings controller, never the browser,
 * supplies this path.
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  chmod, lstat, mkdir, readFile, rename, unlink, writeFile,
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type {
  PersonalizationDocumentView, PersonalizationDocumentWrite, PersonalizationStyle,
} from './types.ts'

/** Maximum UTF-8 size accepted for the Desktop-owned custom instructions. */
export const MAX_PERSONALIZATION_INSTRUCTIONS_BYTES = 48 * 1024

/** Reply styles encoded inside the managed personalization block. */
export const PERSONALIZATION_STYLES = [
  'default', 'concise', 'friendly', 'professional',
] as const satisfies readonly PersonalizationStyle[]

/** Stable validation, conflict, or ownership rejection from document storage. */
export class PersonalizationDocumentError extends Error {
  constructor(
    readonly code: 'invalid' | 'conflict' | 'read-only',
    message: string,
  ) {
    super(message)
    this.name = 'PersonalizationDocumentError'
  }
}

const START = '<!-- dsh-desktop:personalization:start -->'
const END = '<!-- dsh-desktop:personalization:end -->'
const STYLE_PREFIX = '<!-- dsh-desktop:reply-style:'
const STYLE_SUFFIX = ' -->'
const INSTRUCTIONS_START = '<!-- dsh-desktop:instructions:start -->'
const INSTRUCTIONS_END = '<!-- dsh-desktop:instructions:end -->'
const RESERVED_MARKER = '<!-- dsh-desktop:'

const STYLE_RULES: Readonly<Record<Exclude<PersonalizationStyle, 'default'>, string>> = {
  concise: 'Keep replies concise and prioritize the actionable conclusion.',
  friendly: 'Use a warm, friendly tone while keeping technical conclusions precise.',
  professional: 'Use a professional, structured tone and state assumptions and risks clearly.',
}

interface LocatedBlock {
  segmentStart: number
  contentStart: number
  contentEnd: number
  segmentEnd: number
}

function revisionOf(raw: Uint8Array): string {
  return createHash('sha256').update(raw).digest('hex')
}

function locateBlock(raw: Buffer): LocatedBlock | null | 'malformed' {
  const startBytes = Buffer.from(START)
  const endBytes = Buffer.from(END)
  const start = raw.indexOf(startBytes)
  const end = raw.indexOf(endBytes)
  if (start === -1 && end === -1) return null
  if (start === -1 || end === -1 || end < start) return 'malformed'
  if (raw.indexOf(startBytes, start + startBytes.length) !== -1
    || raw.indexOf(endBytes, end + endBytes.length) !== -1) return 'malformed'
  const ownsSeparator = start >= 2 && raw.subarray(start - 2, start).equals(Buffer.from('\n\n'))
  return {
    segmentStart: ownsSeparator ? start - 2 : start,
    contentStart: start + startBytes.length,
    contentEnd: end,
    segmentEnd: end + endBytes.length,
  }
}

function parseManagedContent(raw: Buffer, block: LocatedBlock): {
  instructions: string
  style: PersonalizationStyle
} | null {
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true })
      .decode(raw.subarray(block.contentStart, block.contentEnd))
  } catch {
    return null
  }
  const styleMatch = content.match(/<!-- dsh-desktop:reply-style:(default|concise|friendly|professional) -->/)
  if (styleMatch === null) return null
  const instructionsStart = content.indexOf(INSTRUCTIONS_START)
  const instructionsEnd = content.indexOf(INSTRUCTIONS_END)
  if (instructionsStart === -1 || instructionsEnd < instructionsStart) return null
  const bodyStart = instructionsStart + INSTRUCTIONS_START.length
  const body = content.slice(bodyStart, instructionsEnd)
  const instructions = body.startsWith('\n') && body.endsWith('\n')
    ? body.slice(1, -1)
    : body
  return {
    instructions,
    style: styleMatch[1] as PersonalizationStyle,
  }
}

function outsideBytes(raw: Buffer, block: LocatedBlock | null): Buffer {
  if (block === null) return raw
  return Buffer.concat([raw.subarray(0, block.segmentStart), raw.subarray(block.segmentEnd)])
}

function hasVisibleBytes(raw: Buffer): boolean {
  return raw.toString('utf8').trim().length > 0
}

function renderManagedBlock(instructions: string, style: PersonalizationStyle): Buffer {
  const reply = style === 'default'
    ? ''
    : `\n\n### Reply style\n\n${STYLE_RULES[style]}`
  return Buffer.from([
    START,
    '## DeepSeek Harness Personalization',
    `${STYLE_PREFIX}${style}${STYLE_SUFFIX}`,
    '',
    '### Custom instructions',
    '',
    INSTRUCTIONS_START,
    instructions,
    INSTRUCTIONS_END,
    reply,
    END,
  ].join('\n'))
}

async function existingKind(path: string): Promise<'absent' | 'file' | 'symlink' | 'other'> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) return 'symlink'
    if (info.isFile()) return 'file'
    return 'other'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'
    throw error
  }
}

async function readRegular(path: string): Promise<Buffer> {
  return await existingKind(path) === 'file' ? readFile(path) : Buffer.alloc(0)
}

/**
 * Reads the managed block and ownership state without creating a document.
 * @param path Fixed Host-resolved global AGENTS.md path.
 * @returns Browser-safe content, revision, and writability facts.
 */
export async function readPersonalizationDocument(path: string): Promise<PersonalizationDocumentView> {
  const kind = await existingKind(path)
  if (kind === 'symlink' || kind === 'other') {
    return {
      instructions: '',
      style: 'default',
      revision: revisionOf(Buffer.from(kind)),
      hasExternalContent: true,
      writable: false,
    }
  }
  const raw = kind === 'file' ? await readFile(path) : Buffer.alloc(0)
  const located = locateBlock(raw)
  if (located === 'malformed') {
    return {
      instructions: '', style: 'default', revision: revisionOf(raw),
      hasExternalContent: true, writable: false,
    }
  }
  const managed = located === null ? null : parseManagedContent(raw, located)
  if (located !== null && managed === null) {
    return {
      instructions: '', style: 'default', revision: revisionOf(raw),
      hasExternalContent: true, writable: false,
    }
  }
  return {
    instructions: managed?.instructions ?? '',
    style: managed?.style ?? 'default',
    revision: revisionOf(raw),
    hasExternalContent: hasVisibleBytes(outsideBytes(raw, located)),
    writable: true,
  }
}

function validateWrite(input: PersonalizationDocumentWrite): void {
  if (!PERSONALIZATION_STYLES.includes(input.style)) {
    throw new PersonalizationDocumentError('invalid', 'unsupported personalization reply style')
  }
  if (input.instructions.includes('\0')) {
    throw new PersonalizationDocumentError('invalid', 'personalization instructions cannot contain NUL')
  }
  if (input.instructions.includes(RESERVED_MARKER)) {
    throw new PersonalizationDocumentError('invalid', 'personalization instructions contain a reserved marker')
  }
  if (Buffer.byteLength(input.instructions, 'utf8') > MAX_PERSONALIZATION_INSTRUCTIONS_BYTES) {
    throw new PersonalizationDocumentError(
      'invalid',
      `personalization instructions exceed ${MAX_PERSONALIZATION_INSTRUCTIONS_BYTES} UTF-8 bytes`,
    )
  }
}

async function replaceAtomically(path: string, raw: Buffer): Promise<void> {
  const parent = dirname(path)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const temporary = join(parent, `.${basename(path)}.${randomUUID()}.tmp`)
  const backup = join(parent, `.${basename(path)}.${randomUUID()}.bak`)
  try {
    await writeFile(temporary, raw, { flag: 'wx', mode: 0o600 })
    try {
      await rename(temporary, path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'EPERM') throw error
      await rename(path, backup)
      try {
        await rename(temporary, path)
        await unlink(backup).catch(() => {})
      } catch (replacementError) {
        await rename(backup, path).catch(() => {})
        throw replacementError
      }
    }
    await chmod(path, 0o600).catch((error: unknown) => {
      if (process.platform !== 'win32') throw error
    })
  } finally {
    await unlink(temporary).catch(() => {})
    await unlink(backup).catch(() => {})
  }
}

/**
 * Atomically replaces the managed block after validating ownership and revision.
 * @param path Fixed Host-resolved global AGENTS.md path.
 * @param input Bounded instructions, style, and optimistic revision.
 * @returns Authoritative document state after the replacement.
 */
export async function writePersonalizationDocument(
  path: string,
  input: PersonalizationDocumentWrite,
): Promise<PersonalizationDocumentView> {
  validateWrite(input)
  const before = await readPersonalizationDocument(path)
  if (!before.writable) {
    throw new PersonalizationDocumentError('read-only', 'global personalization document is externally managed')
  }
  if (before.revision !== input.expectedRevision) {
    throw new PersonalizationDocumentError('conflict', 'global personalization changed; reload before saving')
  }
  const raw = await readRegular(path)
  const located = locateBlock(raw)
  if (located === 'malformed') {
    throw new PersonalizationDocumentError('read-only', 'global personalization block is malformed')
  }
  const prefix = located === null ? raw : raw.subarray(0, located.segmentStart)
  const suffix = located === null ? Buffer.alloc(0) : raw.subarray(located.segmentEnd)
  const wantsBlock = input.instructions.length > 0 || input.style !== 'default'
  const next = wantsBlock
    ? Buffer.concat([
      prefix,
      prefix.length === 0 ? Buffer.alloc(0) : Buffer.from('\n\n'),
      renderManagedBlock(input.instructions, input.style),
      suffix,
    ])
    : Buffer.concat([prefix, suffix])
  if (next.equals(raw)) return before
  await replaceAtomically(path, next)
  return readPersonalizationDocument(path)
}
