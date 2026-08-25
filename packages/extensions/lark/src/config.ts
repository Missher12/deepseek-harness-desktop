import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

export const LARK_APP_ID_REF = credentialRef('DSH_LARK_APP_ID')
export const LARK_APP_SECRET_REF = credentialRef('DSH_LARK_APP_SECRET')
export const DEFAULT_MAX_MEDIA_BYTES = 30 * 1024 * 1024
export const DEFAULT_FILE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000

export interface Config {
  enabled?: boolean
  domain?: 'feishu' | 'lark'
  appIdRef?: string
  appSecretRef?: string
  streamThrottleMs?: number
  maxMediaBytes?: number
  fileRetentionMs?: number
  reconnectMinMs?: number
  reconnectMaxMs?: number
}

/** Composition settings contain credential references only, never credential values. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  domain: z.union(['feishu', 'lark']).default('feishu'),
  appIdRef: z.string().default(LARK_APP_ID_REF),
  appSecretRef: z.string().default(LARK_APP_SECRET_REF),
  streamThrottleMs: z.number().min(100).max(5000).default(350),
  maxMediaBytes: z.number().min(1024).max(100 * 1024 * 1024).default(DEFAULT_MAX_MEDIA_BYTES),
  fileRetentionMs: z.number().min(60_000).max(30 * 24 * 60 * 60 * 1_000).default(DEFAULT_FILE_RETENTION_MS),
  reconnectMinMs: z.number().min(250).max(60_000).default(1000),
  reconnectMaxMs: z.number().min(1000).max(10 * 60_000).default(30_000),
})
