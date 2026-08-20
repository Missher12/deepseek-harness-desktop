import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { FileListing, FilePreview, ReviewDiff, ReviewStatus, WorkbenchBootstrap } from '../protocol.ts'

function bootstrap(): WorkbenchBootstrap {
  const value = window.__DSH_DESKTOP_WORKBENCH__
  if (value === undefined) throw new Error('desktop workbench Host bridge is unavailable')
  return value
}

async function request<T>(path: keyof Pick<WorkbenchBootstrap, 'listPath' | 'readPath' | 'reviewPath' | 'diffPath'>, sessionId: SessionId, child?: string): Promise<T> {
  const config = bootstrap()
  const response = await fetch(config[path], {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json', [config.capabilityHeader]: config.capability },
    body: JSON.stringify({ sessionId, ...(child === undefined ? {} : { path: child }) }),
  })
  const value = await response.json() as unknown
  if (!response.ok) {
    const message = typeof value === 'object' && value !== null && 'error' in value ? String(value.error) : 'workbench request failed'
    throw new Error(message)
  }
  return value as T
}

export const workbenchTransport = {
  list: (sessionId: SessionId, path = '') => request<FileListing>('listPath', sessionId, path),
  read: (sessionId: SessionId, path: string) => request<FilePreview>('readPath', sessionId, path),
  status: (sessionId: SessionId) => request<ReviewStatus>('reviewPath', sessionId),
  diff: (sessionId: SessionId, path?: string) => request<ReviewDiff>('diffPath', sessionId, path),
}
