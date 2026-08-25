export interface LarkSettingsStatus {
  enabled: boolean
  connected: boolean
  queuePaused: boolean
  queueDepth: number
  credentials: { appId?: boolean; appSecret?: boolean }
  pairing: string
  binding?: { projectPath: string; sessionId: string } | null
}

export interface LarkSettingsStore {
  load(): Promise<LarkSettingsStatus>
  action(body: Record<string, unknown>): Promise<unknown>
}

interface Bootstrap { path: string; header: string; capability: string }

declare global {
  interface Window { __DSH_LARK__?: Bootstrap }
}

const bootstrap = (): Bootstrap => {
  const value = window.__DSH_LARK__
  if (value?.path !== '/plugins/dsh-lark/control'
    || value.header !== 'x-dsh-lark-capability' || !value.capability) {
    throw new Error('Lark settings capability is unavailable')
  }
  return value
}

export function createLarkSettingsStore(): LarkSettingsStore {
  const call = async (body?: Record<string, unknown>): Promise<unknown> => {
    const value = bootstrap()
    const response = await fetch(value.path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: {
        [value.header]: value.capability,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(`Lark settings request failed (${response.status})`)
    return response.json()
  }
  return {
    load: async () => await call() as LarkSettingsStatus,
    action: body => call(body),
  }
}
