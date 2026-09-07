/**
 * BrowserSkill retirement gate. Desktop no longer installs or mounts the
 * plugin; its reviewed patch and audit record remain available for a future
 * separately reviewed installation.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '..')
const PLUGIN_NAME = '@wxg-prc-cpg/browser-skill-dsh-plugin'
const PLUGIN_VERSION = '0.2.0'
const PLUGIN_INTEGRITY = 'sha512-CwzoviH02P0mwKM7/7NDyurO0r243m4AuM2smgk8nIT6LEBXvt52pbU0RLM71jjHjldFwsJZQoQvJibiVVK51w=='
const AUDITED_COMMIT = '945bf1523dc969ba6c359368c56c01047ccdeeea'
const MAC_ARCHIVE = 'bsk-v0.2.0-x86_64-apple-darwin.tar.gz'
const MAC_SHA256 = '9700ebd84b306acf83c641e0a23db0fe6003fba1d728e640fae4f6abc3e821bc'
const WINDOWS_ARCHIVE = 'bsk-v0.2.0-x86_64-pc-windows-msvc.zip'
const WINDOWS_SHA256 = '57c0459711125c4a5c7f5759ef15b5e45c942e69afa43aaf22bfa06f7fec4590'
const PATCH_PATH = 'patches/@wxg-prc-cpg__browser-skill-dsh-plugin@0.2.0.patch'

function read(relative: string): string {
  return readFileSync(resolve(repositoryRoot, relative), 'utf8')
}

describe('BrowserSkill retirement and retained audit', () => {
  it('keeps the removed plugin out of the lockfile and Desktop dependencies', () => {
    const lockfile = read('pnpm-lock.yaml')
    expect(lockfile).not.toContain(PLUGIN_NAME)
    const desktop = JSON.parse(read('apps/desktop/package.json')) as {
      dependencies: Record<string, string>
    }
    expect(desktop.dependencies[PLUGIN_NAME]).toBeUndefined()
  })

  it('retains the reviewed patch without registering it for installation', () => {
    const workspace = yaml.load(read('pnpm-workspace.yaml')) as {
      patchedDependencies: Record<string, string>
    }
    expect(workspace.patchedDependencies[`${PLUGIN_NAME}@${PLUGIN_VERSION}`]).toBeUndefined()
    expect(existsSync(resolve(repositoryRoot, PATCH_PATH))).toBe(true)
  })

  it('retains the exact historical startup-probe patch boundary', () => {
    const patch = read(PATCH_PATH)
    expect(patch).toContain('-	runner.run(["--version"], { timeoutMs: 1e4 })')
    expect(patch).not.toContain('+	runner.run(["--version"]')
  })

  it('does not mount a Desktop row or floating overlay', () => {
    const patch = yaml.load(read('apps/desktop/desktop.cordis.patch.yml')) as Array<{
      insert?: Array<{ id?: string; name?: string; config?: Record<string, unknown> }>
    }>
    const rows = patch.flatMap(op => op.insert ?? []).filter(row => row.name === PLUGIN_NAME)
    expect(rows).toHaveLength(0)
  })

  it('records the audited commit, license, and both CLI archive digests', () => {
    const doc = read('docs/third-party/browser-skill.md')
    expect(doc).toContain(AUDITED_COMMIT)
    expect(doc).toContain(PLUGIN_INTEGRITY)
    expect(doc).toContain('MIT')
    expect(doc).toContain(MAC_ARCHIVE)
    expect(doc).toContain(MAC_SHA256)
    expect(doc).toContain(WINDOWS_ARCHIVE)
    expect(doc).toContain(WINDOWS_SHA256)
    expect(doc).not.toContain('@latest')
    expect(doc).not.toContain('github.com/Tencent/BrowserSkill/tree/')
  })
})
