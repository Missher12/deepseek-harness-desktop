import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import SettingsController from '../src/index.ts'

const roots: string[] = []

async function target(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-settings-personalization-'))
  roots.push(root)
  return join(root, 'AGENTS.md')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('SettingsController personalization Remote', () => {
  it('owns the fixed document path and classifies stale writes without a settings provider', async () => {
    const path = await target()
    const ctx = new Context()
    const controller = new SettingsController(ctx, {}, { personalizationPath: path })

    const before = await controller.personalizationRead()
    const saved = await controller.personalizationWrite({
      instructions: 'Lead with concrete evidence.',
      style: 'professional',
      expectedRevision: before.revision,
    })

    expect(saved).toMatchObject({
      instructions: 'Lead with concrete evidence.',
      style: 'professional',
      writable: true,
    })
    expect(await readFile(path, 'utf8')).toContain('<!-- dsh-desktop:personalization:start -->')

    const failure = await controller.personalizationWrite({
      instructions: 'stale',
      style: 'default',
      expectedRevision: before.revision,
    }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'settings/rejected',
      details: { ns: 'personalization' },
    })
  })
})
