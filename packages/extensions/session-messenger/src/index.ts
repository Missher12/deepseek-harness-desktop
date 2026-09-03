/** DeepSeek Harness cross-session messaging plugin. */
import type { Context } from '@deepseek-ai/cordis'
import { installSessionMessengerHttp } from './http.ts'
import { activateSessionMessenger } from './tools.ts'

export const name = 'session-messenger'
export const inject = [
  'tools',
  'systemPrompt',
  'storageDomain',
  'workspaceRegistry',
  'typert',
  'agents',
  'sessionPersistence',
  'webServer',
]

export async function apply(ctx: Context): Promise<void> {
  const http = installSessionMessengerHttp(ctx)
  const coordinator = await activateSessionMessenger(ctx)
  http.bind(coordinator, coordinator)
}

export * from './coordinator.ts'
export * from './events.ts'
export * from './http.ts'
export * from './protocol.ts'
export * from './spec.ts'
export * from './target-resolver.ts'
export * from './tools.ts'
export * from './types.ts'
export * from './waits.ts'
