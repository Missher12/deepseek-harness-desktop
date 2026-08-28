import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PRESETS = [
  'standard', 'code', 'frontend', 'backend', 'devops', 'qa',
  'reviewer', 'research', 'planner', 'debugger', 'cordis',
] as const

describe('browser tool preset composition', () => {
  it.each(PRESETS)('conditionally composes browser tools in %s', async (preset) => {
    const source = await readFile(resolve('apps/cli/config/agent-presets', preset, 'agent.cordis.yml'), 'utf8')
    expect(source.match(/name: '@deepseek-ai\/dsh-tool-browser-control'/gu)).toHaveLength(1)
  })

  it('keeps the minimal preset free of browser control tools', async () => {
    const source = await readFile(resolve('apps/cli/config/agent-presets/minimal/agent.cordis.yml'), 'utf8')
    expect(source).not.toContain('@deepseek-ai/dsh-tool-browser-control')
  })
})
