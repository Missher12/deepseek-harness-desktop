import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

function assertContained(root: string, candidate: string): void {
  const rel = relative(root, candidate)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('path is outside workspace')
  }
}

/**
 * Canonicalize an existing child and reject lexical or symlink escape.
 * @param root - workspace root.
 * @param child - relative existing child.
 * @returns canonical contained path.
 */
export async function resolveWorkspacePath(root: string, child = ''): Promise<string> {
  if (isAbsolute(child)) throw new Error('path is outside workspace')
  const canonicalRoot = await realpath(root)
  const candidate = await realpath(resolve(canonicalRoot, child))
  assertContained(canonicalRoot, candidate)
  return candidate
}

/**
 * Validate a workspace child even when the final file has been deleted.
 * @param root - workspace root.
 * @param child - relative child whose parent still exists.
 * @returns contained lexical target under a canonical parent.
 */
export async function resolveOptionalWorkspacePath(root: string, child: string): Promise<string> {
  if (isAbsolute(child) || child.includes('\0')) throw new Error('path is outside workspace')
  const canonicalRoot = await realpath(root)
  const candidate = resolve(canonicalRoot, child)
  assertContained(canonicalRoot, candidate)
  const canonicalParent = await realpath(dirname(candidate))
  assertContained(canonicalRoot, canonicalParent)
  return candidate
}
