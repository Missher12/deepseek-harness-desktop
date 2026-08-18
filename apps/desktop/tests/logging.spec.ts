import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLifecycleLogger, redactLogText } from '../src/logging.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('redactLogText', () => {
  it('redacts credential assignments and bearer tokens without hiding lifecycle facts', () => {
    const text = 'pid=42 DEEPSEEK_API_KEY=secret-value Authorization: Bearer abc.def exit=1'
    expect(redactLogText(text)).toBe(
      'pid=42 DEEPSEEK_API_KEY=[REDACTED_SECRET] Authorization: Bearer [REDACTED_SECRET] exit=1',
    )
  })

  it('redacts JSON credential fields and credential query values', () => {
    expect(redactLogText('{"apiKey":"value"} url=https://example.test/?token=abc&mode=1'))
      .toBe('{"apiKey":"[REDACTED_SECRET]"} url=https://example.test/?token=[REDACTED_SECRET]&mode=1')
  })
})

describe('createLifecycleLogger', () => {
  it('writes one owner-only redacted line', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-log-'))
    temporaryRoots.push(root)
    const logPath = join(root, 'nested', 'lifecycle.log')
    const logger = createLifecycleLogger(logPath, { now: () => new Date('2026-08-13T00:00:00.000Z') })

    await logger.write('pid=42\nDEEPSEEK_API_KEY=secret')

    expect(await readFile(logPath, 'utf8')).toBe(
      '2026-08-13T00:00:00.000Z pid=42\\nDEEPSEEK_API_KEY=[REDACTED_SECRET]\n',
    )
    if (process.platform !== 'win32') {
      expect((await stat(join(root, 'nested'))).mode & 0o777).toBe(0o700)
      expect((await stat(logPath)).mode & 0o777).toBe(0o600)
    }
  })
})
