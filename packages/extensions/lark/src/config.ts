import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

/** Default write-only credential reference for the Lark App ID. */
export const LARK_APP_ID_REF = credentialRef('DSH_LARK_APP_ID')
/** Default write-only credential reference for the Lark App Secret. */
export const LARK_APP_SECRET_REF = credentialRef('DSH_LARK_APP_SECRET')
/** Default hard limit for one downloaded Feishu resource. */
export const DEFAULT_MAX_MEDIA_BYTES = 30 * 1024 * 1024
/** Default retention for private generic-file staging. */
export const DEFAULT_FILE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000

/** Credential references and bounded runtime settings for the Lark plugin. */
export interface Config {
  /** Whether the receiver and Session projection are locally enabled. */
  enabled?: boolean
  /** Official API domain used by the self-built app. */
  domain?: 'feishu' | 'lark'
  /** Credential-store reference containing the App ID. */
  appIdRef?: string
  /** Credential-store reference containing the App Secret. */
  appSecretRef?: string
  /** Minimum interval between streamed card updates. */
  streamThrottleMs?: number
  /** Maximum bytes accepted for one inbound image or file. */
  maxMediaBytes?: number
  /** Retention time for plugin-owned generic-file staging. */
  fileRetentionMs?: number
  /** Maximum wait for the official SDK connection-ready callback. */
  handshakeTimeoutMs?: number
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
  handshakeTimeoutMs: z.number().min(1000).max(60_000).default(15_000),
})
