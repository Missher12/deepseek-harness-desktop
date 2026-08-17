/** DeepSeek Harness cross-session messaging plugin. */
import type { Context } from '@deepseek-ai/cordis'
import { activateSessionMessenger } from './tools.ts'

export const name = 'session-messenger'
export const inject = [
  'tools',
  'storageDomain',
  'workspaceRegistry',
  'typert',
  'agents',
  'sessionPersistence',
]

export async function apply(ctx: Context): Promise<void> {
  await activateSessionMessenger(ctx)
}

export * from './coordinator.ts'
export * from './spec.ts'
export * from './target-resolver.ts'
export * from './tools.ts'
export * from './types.ts'
export * from './waits.ts'
