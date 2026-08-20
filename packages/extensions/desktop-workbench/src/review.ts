import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { MAX_DIFF_BYTES, type ReviewDiff, type ReviewStatus } from './protocol.ts'
import { resolveOptionalWorkspacePath, resolveWorkspacePath } from './workspace-path.ts'

const execFile = promisify(execFileCallback)

/**
 * Read bounded Git working-tree status.
 * @param root - live session workspace root.
 * @returns changed paths and status codes.
 */
export async function gitStatus(root: string): Promise<ReviewStatus> {
  const workspace = await resolveWorkspacePath(root)
  let stdout: string
  try {
    const result = await execFile('git', ['-C', workspace, 'status', '--porcelain=v1', '--untracked-files=normal', '--', '.'], {
      encoding: 'utf8', maxBuffer: 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    })
    stdout = result.stdout
  } catch (error: unknown) {
    const failure = error as { code?: unknown; stderr?: unknown }
    if (failure.code === 128 && typeof failure.stderr === 'string' && failure.stderr.includes('not a git repository')) {
      return { entries: [], truncated: false }
    }
    throw error
  }
  const lines = stdout.split('\n').filter(Boolean)
  return {
    entries: lines.slice(0, 200).map(line => ({ status: line.slice(0, 2), path: line.slice(3) })),
    truncated: lines.length > 200,
  }
}

/**
 * Read one bounded, non-mutating Git diff.
 * @param root - live session workspace root.
 * @param child - optional relative changed path.
 * @returns bounded unified diff text.
 */
export async function gitDiff(root: string, child?: string): Promise<ReviewDiff> {
  const workspace = await resolveWorkspacePath(root)
  if (child !== undefined && child !== '') await resolveOptionalWorkspacePath(workspace, child)
  const args = ['-C', workspace, 'diff', '--no-ext-diff', '--unified=3', '--', child === undefined || child === '' ? '.' : child]
  const { stdout } = await execFile('git', args, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
  const bytes = Buffer.from(stdout)
  return {
    ...(child === undefined ? {} : { path: child }),
    text: bytes.subarray(0, MAX_DIFF_BYTES).toString('utf8'),
    truncated: bytes.byteLength > MAX_DIFF_BYTES,
  }
}
