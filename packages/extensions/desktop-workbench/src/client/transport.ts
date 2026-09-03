import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { REQUEST_FAILED_FALLBACK } from './locales.ts'
import type {
  BrowserSkillStatus, FileListing, FilePreview, ReviewDiff, ReviewStatus, WorkbenchBootstrap, WorkbenchTerminalSnapshot,
} from '../protocol.ts'

function bootstrap(): WorkbenchBootstrap {
  const value = window.__DSH_DESKTOP_WORKBENCH__
  if (value === undefined) throw new Error('desktop workbench Host bridge is unavailable')
  return value
}

type RequestPath = keyof Pick<WorkbenchBootstrap,
  'listPath' | 'readPath' | 'reviewPath' | 'diffPath' | 'terminalOpenPath'
  | 'terminalActionPath' | 'terminalSnapshotPath' | 'browserSkillStatusPath'>

async function request<T>(path: RequestPath, sessionId: SessionId, extra: Record<string, unknown> = {}): Promise<T> {
  const config = bootstrap()
  const response = await fetch(config[path], {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json', [config.capabilityHeader]: config.capability },
    body: JSON.stringify({ sessionId, ...extra }),
  })
  const value = await response.json() as unknown
  if (!response.ok) {
    const message = typeof value === 'object' && value !== null && 'error' in value ? String(value.error) : REQUEST_FAILED_FALLBACK
    throw new Error(message)
  }
  return value as T
}

/** Capability-bound same-origin workbench transport. */
export const workbenchTransport = {
  list: (sessionId: SessionId, path = '') => request<FileListing>('listPath', sessionId, { path }),
  read: (sessionId: SessionId, path: string) => request<FilePreview>('readPath', sessionId, { path }),
  status: (sessionId: SessionId) => request<ReviewStatus>('reviewPath', sessionId),
  diff: (sessionId: SessionId, path?: string) => request<ReviewDiff>('diffPath', sessionId, path === undefined ? {} : { path }),
  openTerminal: (sessionId: SessionId) => request<WorkbenchTerminalSnapshot>('terminalOpenPath', sessionId),
  terminalSnapshots: (sessionId: SessionId) => request<{ terminals: WorkbenchTerminalSnapshot[] }>('terminalSnapshotPath', sessionId),
  terminalAction: (sessionId: SessionId, id: string, action: 'write' | 'signal' | 'close', value?: string) =>
    request<{ ok: true }>('terminalActionPath', sessionId, { id, action, ...(value === undefined ? {} : { value }) }),
  browserSkillStatus: (sessionId: SessionId) =>
    request<BrowserSkillStatus>('browserSkillStatusPath', sessionId),
}
