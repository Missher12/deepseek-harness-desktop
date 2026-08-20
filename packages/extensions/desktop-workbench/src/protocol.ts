export const MAX_DIRECTORY_ENTRIES = 200
export const MAX_PREVIEW_BYTES = 256 * 1024
export const MAX_DIFF_BYTES = 256 * 1024

export interface WorkbenchBootstrap {
  listPath: string
  readPath: string
  reviewPath: string
  diffPath: string
  capabilityHeader: string
  capability: string
}

export interface FileEntry { name: string; path: string; kind: 'directory' | 'file'; size?: number }
export interface FileListing { path: string; entries: FileEntry[]; truncated: boolean }
export interface FilePreview { path: string; size: number; binary: boolean; text?: string; truncated: boolean }
export interface ReviewEntry { path: string; status: string }
export interface ReviewStatus { entries: ReviewEntry[]; truncated: boolean }
export interface ReviewDiff { path?: string; text: string; truncated: boolean }

declare global { interface Window { __DSH_DESKTOP_WORKBENCH__?: WorkbenchBootstrap } }
