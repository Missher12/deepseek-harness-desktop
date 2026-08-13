import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stageDesktop, type StageDesktopDependencies } from './stage-desktop.ts'

function fakeDependencies(
  filesPresent = true,
  nativeBinaries: readonly string[] = ['/repo/apps/desktop/.stage/node_modules/node-pty/prebuilds/darwin-x64/pty.node'],
): StageDesktopDependencies & {
  commands: Array<[string, readonly string[]]>
  copies: Array<[string, string]>
  removed: string[]
  validated: string[]
} {
  const commands: Array<[string, readonly string[]]> = []
  const copies: Array<[string, string]> = []
  const removed: string[] = []
  const validated: string[] = []
  return {
    commands,
    copies,
    removed,
    validated,
    remove: async (path) => { removed.push(path) },
    run: (command, args) => { commands.push([command, args]) },
    copy: async (source, target) => { copies.push([source, target]) },
    isFile: async (path) => {
      validated.push(path)
      return filesPresent
    },
    findNativeBinaries: async () => nativeBinaries,
  }
}

describe('stageDesktop', () => {
  it('deploys production dependencies and validates the complete app closure', async () => {
    const dependencies = fakeDependencies()

    const result = await stageDesktop('/repo', dependencies)

    expect(dependencies.commands).toEqual([
      ['pnpm', ['--filter', '@deepseek-ai/dsh-desktop', 'deploy', '--legacy', '/repo/apps/desktop/.stage']],
    ])
    expect(dependencies.copies).toEqual([
      ['/repo/apps/desktop/lib', '/repo/apps/desktop/.stage/lib'],
      ['/repo/apps/desktop/renderer', '/repo/apps/desktop/.stage/renderer'],
      ['/repo/apps/desktop/assets', '/repo/apps/desktop/.stage/assets'],
      ['/repo/apps/desktop/electron-builder.yml', '/repo/apps/desktop/.stage/electron-builder.yml'],
    ])
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh/lib/bin.js')
    expect(result.validatedFiles).toContain('node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html')
    expect(result.validatedFiles).toContain('lib/preload.cjs')
    expect(result.validatedFiles).not.toContain('lib/preload.js')
    expect(result.validatedFiles).toContain('assets/icon-source.png')
    expect(result.validatedFiles).toContain('assets/icon.icns')
    expect(result.validatedFiles).toContain('assets/icon.ico')
    expect(result.validatedFiles).not.toContain('assets/icon-source-rounded.png')
    expect(result.validatedFiles).toContain('node_modules/node-pty/prebuilds/darwin-x64/pty.node')
  })

  it('fails closed when a required file or native module is absent', async () => {
    await expect(stageDesktop('/repo', fakeDependencies(false))).rejects.toThrow(/missing required file/i)
    await expect(stageDesktop('/repo', fakeDependencies(true, []))).rejects.toThrow(/native.*\.node/i)
  })

  it('removes only the exact desktop stage directory', async () => {
    const dependencies = fakeDependencies()
    await stageDesktop('/repo', dependencies)

    expect(dependencies.removed).toEqual([join('/repo', 'apps/desktop/.stage')])
  })
})
