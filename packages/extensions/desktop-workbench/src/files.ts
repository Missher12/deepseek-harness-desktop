import { open, readdir, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { MAX_DIRECTORY_ENTRIES, MAX_PREVIEW_BYTES, type FileListing, type FilePreview } from './protocol.ts'
import { resolveWorkspacePath } from './workspace-path.ts'

const slash = (value: string): string => value.split(sep).join('/')

/**
 * List one bounded visible workspace directory.
 * @param root - live session workspace root.
 * @param child - relative directory path.
 * @returns a bounded directory listing.
 */
export async function listWorkspace(root: string, child = ''): Promise<FileListing> {
  const canonicalRoot = await resolveWorkspacePath(root)
  const directory = await resolveWorkspacePath(canonicalRoot, child)
  const info = await stat(directory)
  if (!info.isDirectory()) throw new Error('workspace path is not a directory')
  const all = await readdir(directory, { withFileTypes: true })
  const visible = all.filter(entry => !entry.name.startsWith('.'))
    .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name))
  const entries = await Promise.all(visible.slice(0, MAX_DIRECTORY_ENTRIES).map(async (entry) => {
    const absolute = await resolveWorkspacePath(canonicalRoot, join(relative(canonicalRoot, directory), entry.name))
    const entryInfo = await stat(absolute)
    return {
      name: basename(absolute),
      path: slash(relative(canonicalRoot, absolute)),
      kind: entryInfo.isDirectory() ? 'directory' as const : 'file' as const,
      ...(entryInfo.isFile() ? { size: entryInfo.size } : {}),
    }
  }))
  return { path: slash(relative(canonicalRoot, directory)), entries, truncated: visible.length > entries.length }
}

/**
 * Read one bounded workspace file preview.
 * @param root - live session workspace root.
 * @param child - relative file path.
 * @returns text or binary metadata within the preview cap.
 */
export async function readWorkspaceFile(root: string, child: string): Promise<FilePreview> {
  const canonicalRoot = await resolveWorkspacePath(root)
  const target = await resolveWorkspacePath(canonicalRoot, child)
  const info = await stat(target)
  if (!info.isFile()) throw new Error('workspace path is not a file')
  const length = Math.min(info.size, MAX_PREVIEW_BYTES + 1)
  const bytes = Buffer.alloc(length)
  const handle = await open(target, 'r')
  try { await handle.read(bytes, 0, length, 0) } finally { await handle.close() }
  const binary = bytes.subarray(0, Math.min(length, 8192)).includes(0)
  const truncated = info.size > MAX_PREVIEW_BYTES
  return {
    path: slash(relative(canonicalRoot, target)),
    size: info.size,
    binary,
    ...(binary ? {} : { text: bytes.subarray(0, MAX_PREVIEW_BYTES).toString('utf8') }),
    truncated,
  }
}
