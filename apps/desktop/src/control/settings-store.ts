export interface ControlSettings {
  readonly schemaVersion: 1
  readonly ordinaryAppIds: readonly string[]
  readonly browserEnabled: boolean
  readonly computerEnabled: boolean
  readonly emergencyAccelerator: string
}

export const DEFAULT_CONTROL_SETTINGS: ControlSettings = Object.freeze({
  schemaVersion: 1,
  ordinaryAppIds: Object.freeze([]),
  browserEnabled: false,
  computerEnabled: false,
  emergencyAccelerator: 'CommandOrControl+Shift+F12',
})

export interface ControlSettingsWriteOptions {
  readonly writeAtomic?: (filename: string, content: string) => Promise<void>
}

const KEYS = Object.freeze([
  'schemaVersion', 'ordinaryAppIds', 'browserEnabled', 'computerEnabled', 'emergencyAccelerator',
] as const)
const APP_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const ACCELERATOR = /^[\x20-\x7e]{1,128}$/
const MAX_SETTINGS_BYTES = 16 * 1024

function skipWhitespace(text: string, start: number): number {
  let index = start
  while (index < text.length && /\s/.test(text.charAt(index))) index++
  return index
}

function endOfJsonString(text: string, start: number): number {
  let escaped = false
  for (let index = start + 1; index < text.length; index++) {
    const char = text.charAt(index)
    if (escaped) escaped = false
    else if (char === '\\') escaped = true
    else if (char === '"') return index + 1
  }
  return -1
}

function endOfJsonValue(text: string, start: number): number {
  let objectDepth = 0
  let arrayDepth = 0
  for (let index = start; index < text.length; index++) {
    const char = text.charAt(index)
    if (char === '"') {
      const end = endOfJsonString(text, index)
      if (end < 0) return -1
      index = end - 1
      continue
    }
    if (char === '{') objectDepth++
    else if (char === '[') arrayDepth++
    else if (char === '}') {
      if (objectDepth === 0 && arrayDepth === 0) return index
      objectDepth--
    } else if (char === ']') arrayDepth--
    else if (char === ',' && objectDepth === 0 && arrayDepth === 0) return index
  }
  return -1
}

function hasDuplicateRootKey(text: string): boolean {
  let index = skipWhitespace(text, 0)
  if (text[index++] !== '{') return true
  const keys = new Set<string>()
  for (;;) {
    index = skipWhitespace(text, index)
    if (text[index] === '}') return false
    if (text[index] !== '"') return true
    const end = endOfJsonString(text, index)
    if (end < 0) return true
    const key: unknown = JSON.parse(text.slice(index, end))
    if (typeof key !== 'string' || keys.has(key)) return true
    keys.add(key)
    index = skipWhitespace(text, end)
    if (text[index++] !== ':') return true
    index = endOfJsonValue(text, skipWhitespace(text, index))
    if (index < 0) return true
    if (text[index] === '}') return false
    if (text[index++] !== ',') return true
  }
}

function plainRecord(value: unknown): value is object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function ownData(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  return descriptor !== undefined && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}

function validSettings(value: unknown): ControlSettings | null {
  if (!plainRecord(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== KEYS.length || keys.some(key => !KEYS.includes(key as typeof KEYS[number]))) {
    return null
  }
  const schemaVersion = ownData(value, 'schemaVersion')
  const appIds = ownData(value, 'ordinaryAppIds')
  const browserEnabled = ownData(value, 'browserEnabled')
  const computerEnabled = ownData(value, 'computerEnabled')
  const emergencyAccelerator = ownData(value, 'emergencyAccelerator')
  if (schemaVersion !== 1 || !Array.isArray(appIds) || appIds.length > 128
    || typeof browserEnabled !== 'boolean' || typeof computerEnabled !== 'boolean'
    || typeof emergencyAccelerator !== 'string' || !ACCELERATOR.test(emergencyAccelerator)) {
    return null
  }
  const seen = new Set<string>()
  const checkedAppIds: string[] = []
  for (const appId of appIds) {
    if (typeof appId !== 'string' || !APP_ID.test(appId)
      || Buffer.byteLength(appId, 'utf8') > 256 || seen.has(appId)) return null
    seen.add(appId)
    checkedAppIds.push(appId)
  }
  return Object.freeze({
    schemaVersion: 1,
    ordinaryAppIds: Object.freeze(checkedAppIds),
    browserEnabled,
    computerEnabled,
    emergencyAccelerator,
  })
}

export async function readControlSettings(filename: string): Promise<ControlSettings> {
  try {
    const metadata = await lstat(filename)
    if (!metadata.isFile() || metadata.isSymbolicLink()) return DEFAULT_CONTROL_SETTINGS
    if (metadata.size > MAX_SETTINGS_BYTES) return DEFAULT_CONTROL_SETTINGS
    const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const contents = await handle.readFile({ encoding: 'utf8' })
      if (Buffer.byteLength(contents, 'utf8') > MAX_SETTINGS_BYTES
        || hasDuplicateRootKey(contents)) return DEFAULT_CONTROL_SETTINGS
      const value: unknown = JSON.parse(contents)
      return validSettings(value) ?? DEFAULT_CONTROL_SETTINGS
    } finally {
      await handle.close()
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (error instanceof SyntaxError || code === 'ENOENT' || code === 'ELOOP') {
      return DEFAULT_CONTROL_SETTINGS
    }
    throw error
  }
}

export async function writeControlSettings(
  filename: string,
  settings: ControlSettings,
  options?: ControlSettingsWriteOptions,
): Promise<void> {
  const normalized = validSettings(settings)
  if (normalized === null) throw new TypeError('Invalid control settings.')
  const content = `${JSON.stringify(normalized)}\n`
  if (options?.writeAtomic !== undefined) {
    await options.writeAtomic(filename, content)
    return
  }
  await writeFileAtomic(filename, content, { mode: 0o600, dirMode: 0o700 })
}
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
