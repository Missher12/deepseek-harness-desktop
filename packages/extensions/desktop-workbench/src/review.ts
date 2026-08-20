import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { MAX_DIFF_BYTES, type ReviewDiff, type ReviewStatus } from './protocol.ts'
import { resolveOptionalWorkspacePath, resolveWorkspacePath } from './workspace-path.ts'

const execFile = promisify(execFileCallback)

export async function gitStatus(root: string): Promise<ReviewStatus> {
  const workspace = await resolveWorkspacePath(root)
  const { stdout } = await execFile('git', ['-C', workspace, 'status', '--porcelain=v1', '--untracked-files=normal', '--', '.'], {
    encoding: 'utf8', maxBuffer: 1024 * 1024,
  })
  const lines = stdout.split('\n').filter(Boolean)
  return {
    entries: lines.slice(0, 200).map(line => ({ status: line.slice(0, 2), path: line.slice(3) })),
    truncated: lines.length > 200,
  }
}

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
