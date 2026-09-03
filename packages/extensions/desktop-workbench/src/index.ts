/** Desktop workbench Host half. */
import type { Context } from '@deepseek-ai/cordis'
import { installWorkbenchHttp } from './http.ts'

export const name = 'desktop-workbench'
export const inject = ['sessions', 'webServer', 'subprocess']
export function apply(ctx: Context): void { installWorkbenchHttp(ctx) }
export * from './protocol.ts'
