/** Renderer-visible browser geometry with no control-authority fields. */
export interface DesktopBrowserBounds { x: number; y: number; width: number; height: number }

/** Closed Workbench browser request roster. */
export type DesktopBrowserRequest =
  | { kind: 'navigate'; value: string }
  | { kind: 'back' | 'forward' | 'reload' | 'stop' }

/** Bounded Workbench browser state exposed through the preload bridge. */
export interface DesktopBrowserSnapshot {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
}

/** Validate renderer-supplied Dock geometry. */
export function isDesktopBrowserBounds(value: unknown): value is DesktopBrowserBounds {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]))
    && (item.width as number) >= 1 && (item.height as number) >= 1
}

/** Normalize a human-entered Workbench browser destination. */
export function normalizeBrowserTarget(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const candidate = /^[a-z][a-z\d+.-]*:/iu.test(trimmed)
    ? trimmed
    : trimmed.includes('.') && !/\s/u.test(trimmed)
      ? `https://${trimmed}`
      : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch { return undefined }
}

/** Validate a closed Workbench browser request. */
export function isDesktopBrowserRequest(value: unknown): value is DesktopBrowserRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (item.kind === 'navigate') return typeof item.value === 'string' && normalizeBrowserTarget(item.value) !== undefined
  return item.kind === 'back' || item.kind === 'forward' || item.kind === 'reload' || item.kind === 'stop'
}

/** Validate one main-owned Workbench browser state snapshot. */
export function isDesktopBrowserSnapshot(value: unknown): value is DesktopBrowserSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.url === 'string' && typeof item.title === 'string' && typeof item.loading === 'boolean'
    && typeof item.canGoBack === 'boolean' && typeof item.canGoForward === 'boolean'
    && (item.error === null || typeof item.error === 'string')
}
