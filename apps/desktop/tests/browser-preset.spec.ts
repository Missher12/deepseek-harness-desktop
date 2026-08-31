import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PRESETS = [
  ['standard', 'packages/preset/agent-presets/presets/standard/agent.cordis.yml'],
  ['ptc', 'packages/preset/agent-presets/presets/ptc/agent.cordis.yml'],
  ['cordis', 'packages/preset/agent-presets/presets/cordis/agent.cordis.yml'],
  ...['frontend', 'backend', 'devops', 'qa', 'reviewer', 'research', 'planner', 'debugger']
    .map(preset => [preset, `packages/preset/agent-presets/presets/${preset}/agent.cordis.yml`] as const),
] as const

describe('browser tool preset composition', () => {
  it.each(PRESETS)('conditionally composes browser tools in %s', async (_preset, path) => {
    const source = await readFile(resolve(path), 'utf8')
    expect(source.match(/name: '@deepseek-ai\/dsh-tool-browser-control'/gu)).toHaveLength(1)
  })

  it('keeps the minimal preset free of browser control tools', async () => {
    const source = await readFile(resolve('packages/preset/agent-presets/presets/minimal/agent.cordis.yml'), 'utf8')
    expect(source).not.toContain('@deepseek-ai/dsh-tool-browser-control')
  })
})
