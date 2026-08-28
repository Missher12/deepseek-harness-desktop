import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PRESETS = [
  'standard', 'code', 'frontend', 'backend', 'devops', 'qa',
  'reviewer', 'research', 'planner', 'debugger', 'cordis',
] as const

describe('computer tool and Desktop UI composition', () => {
  it.each(PRESETS)('conditionally composes computer tools in %s', async (preset) => {
    const source = await readFile(resolve('apps/cli/config/agent-presets', preset, 'agent.cordis.yml'), 'utf8')
    expect(source.match(/name: '@deepseek-ai\/dsh-tool-computer-control'/gu)).toHaveLength(1)
  })

  it('keeps the minimal preset free of computer control tools', async () => {
    const source = await readFile(resolve('apps/cli/config/agent-presets/minimal/agent.cordis.yml'), 'utf8')
    expect(source).not.toContain('@deepseek-ai/dsh-tool-computer-control')
  })

  it('mounts the Desktop-only status/settings plugin once', async () => {
    const source = await readFile(resolve('apps/desktop/desktop.cordis.patch.yml'), 'utf8')
    expect(source.match(/name: '@deepseek-ai\/dsh-client-ui-desktop-control'/gu)).toHaveLength(1)
  })
})
