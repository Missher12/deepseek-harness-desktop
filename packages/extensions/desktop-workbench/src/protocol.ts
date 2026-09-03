/** Maximum rows returned from one directory. */
export const MAX_DIRECTORY_ENTRIES = 200
/** Maximum bytes exposed in one text preview. */
export const MAX_PREVIEW_BYTES = 256 * 1024
/** Maximum bytes exposed in one Git diff. */
export const MAX_DIFF_BYTES = 256 * 1024
/** Maximum retained bytes for one user terminal. */
export const MAX_TERMINAL_OUTPUT_BYTES = 1024 * 1024
/** Maximum bytes accepted by one terminal write. */
export const MAX_TERMINAL_INPUT_BYTES = 16 * 1024

/** Generation-bound Client bootstrap for exact Host routes. */
export interface WorkbenchBootstrap {
  listPath: string
  readPath: string
  reviewPath: string
  diffPath: string
  terminalOpenPath: string
  terminalActionPath: string
  terminalSnapshotPath: string
  capabilityHeader: string
  capability: string
}

/** One read-only workspace listing entry. */
export interface FileEntry { name: string; path: string; kind: 'directory' | 'file'; size?: number }
/** One bounded workspace directory listing. */
export interface FileListing { path: string; entries: FileEntry[]; truncated: boolean }
/** One bounded text or binary file preview. */
export interface FilePreview { path: string; size: number; binary: boolean; text?: string; truncated: boolean }
/** One changed Git path. */
export interface ReviewEntry { path: string; status: string }
/** Bounded Git working-tree status. */
export interface ReviewStatus { entries: ReviewEntry[]; truncated: boolean }
/** Bounded unified Git diff. */
export interface ReviewDiff { path?: string; text: string; truncated: boolean }
/** Closed lifecycle for a user-owned terminal. */
export type WorkbenchTerminalStatus = 'running' | 'exited'
/** Pollable bounded terminal state. */
export interface WorkbenchTerminalSnapshot {
  id: string
  cwd: string
  pid: number
  output: string
  revision: number
  status: WorkbenchTerminalStatus
  exitCode?: number | null
}

declare global { interface Window { __DSH_DESKTOP_WORKBENCH__?: WorkbenchBootstrap } }
