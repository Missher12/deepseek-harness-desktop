import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

describe('settings personalization Remote', () => {
  it('reads and revision-checks the fixed Host-owned document', async () => {
    const path = await target()
    const controller = new SettingsController(new Context(), {}, { personalizationPath: path })

    const before = await controller.personalizationRead()
    const written = await controller.personalizationWrite({
      instructions: 'Keep the answer actionable.',
      style: 'concise',
      expectedRevision: before.revision,
    })

    expect(written).toMatchObject({
      instructions: 'Keep the answer actionable.',
      style: 'concise',
      writable: true,
    })
    expect(await readFile(path, 'utf8')).toContain('Keep the answer actionable.')
  })

  it('maps storage refusals to a bounded settings error', async () => {
    const path = await target()
    await writeFile(path, '<!-- dsh-desktop:personalization:start -->')
    const controller = new SettingsController(new Context(), {}, { personalizationPath: path })
    const view = await controller.personalizationRead()

    const failure = await controller.personalizationWrite({
      instructions: 'replace',
      style: 'default',
      expectedRevision: view.revision,
    }).catch((error: unknown) => error)

    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'settings/rejected',
      details: { ns: 'personalization' },
    })
  })
})
