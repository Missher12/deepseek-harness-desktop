/**
 * BrowserSkill third-party supply-chain gate.
 *
 * Every third-party input is pinned: the npm package version and integrity,
 * the per-platform CLI archive digests, the audited upstream commit, and the
 * local patch boundary. `latest`, branch URLs, and unpinned downloads are
 * rejected by construction because this file is the only place the pins can
 * change.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '..')
const PLUGIN_NAME = '@wxg-prc-cpg/browser-skill-dsh-plugin'
const PLUGIN_VERSION = '0.1.2'
const PLUGIN_INTEGRITY = 'sha512-k6BeAN0SpuaBj0M62wQhcKjCN7Fk6K6NTzGc/5c6LnOW2EvfQxdBssdnKhn7lLyTN3qHktCTpTeJsHdQUcnnTg=='
const AUDITED_COMMIT = '945bf1523dc969ba6c359368c56c01047ccdeeea'
const MAC_ARCHIVE = 'bsk-v0.1.11-x86_64-apple-darwin.tar.gz'
const MAC_SHA256 = 'f1e0749fc2fac11f81d931862efa331bb9fcba30d1a5cce83b2a10626bb02bf6'
const WINDOWS_ARCHIVE = 'bsk-v0.1.11-x86_64-pc-windows-msvc.zip'
const WINDOWS_SHA256 = '041785147342a704fd576470e63307880043a15ad52e0553f12e6dcf360ccf74'
const PATCH_PATH = 'patches/@wxg-prc-cpg__browser-skill-dsh-plugin@0.1.2.patch'

function read(relative: string): string {
  return readFileSync(resolve(repositoryRoot, relative), 'utf8')
}

describe('BrowserSkill supply chain', () => {
  it('pins the exact npm version and integrity in the lockfile', () => {
    const lockfile = read('pnpm-lock.yaml')
    const entry = lockfile.match(new RegExp(
      `'${PLUGIN_NAME.replaceAll('/', '\\/')}@${PLUGIN_VERSION}':\\n\\s+resolution: \\{integrity: ([^}]+)\\}`,
      'u',
    ))
    expect(entry?.[1]).toBe(PLUGIN_INTEGRITY)
    // The desktop manifest must pin the exact version, never a range or tag.
    const desktop = JSON.parse(read('apps/desktop/package.json')) as {
      dependencies: Record<string, string>
    }
    expect(desktop.dependencies[PLUGIN_NAME]).toBe(PLUGIN_VERSION)
    expect(desktop.dependencies[PLUGIN_NAME]).not.toMatch(/[\^~*]/u)
  })

  it('registers the reviewed patch for exactly the pinned version', () => {
    const workspace = yaml.load(read('pnpm-workspace.yaml')) as {
      patchedDependencies: Record<string, string>
    }
    expect(workspace.patchedDependencies[`${PLUGIN_NAME}@${PLUGIN_VERSION}`]).toBe(PATCH_PATH)
    expect(existsSync(resolve(repositoryRoot, PATCH_PATH))).toBe(true)
  })

  it('keeps the startup probe out of the patched entry without touching tool behavior', () => {
    const patch = read(PATCH_PATH)
    expect(patch).toContain('-	runner.run(["--version"], { timeoutMs: 1e4 })')
    expect(patch).not.toContain('+	runner.run(["--version"]')
    // The real tool invocations still target the runner.
    const patchedEntry = read('apps/desktop/node_modules/@wxg-prc-cpg/browser-skill-dsh-plugin/lib/index.mjs')
    expect(patchedEntry).not.toContain('runner.run(["--version"]')
    expect(patchedEntry).toContain('runner.run(')
  })

  it('mounts the Desktop row default-sleeping without the floating overlay', () => {
    const patch = yaml.load(read('apps/desktop/desktop.cordis.patch.yml')) as Array<{
      insert?: Array<{ id?: string; name?: string; config?: Record<string, unknown> }>
    }>
    const rows = patch.flatMap(op => op.insert ?? []).filter(row => row.name === PLUGIN_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.config).toMatchObject({ lazyTools: true, observationEnabled: false })
  })

  it('records the audited commit, license, and both CLI archive digests', () => {
    const doc = read('docs/third-party/browser-skill.md')
    expect(doc).toContain(AUDITED_COMMIT)
    expect(doc).toContain('MIT')
    expect(doc).toContain(MAC_ARCHIVE)
    expect(doc).toContain(MAC_SHA256)
    expect(doc).toContain(WINDOWS_ARCHIVE)
    expect(doc).toContain(WINDOWS_SHA256)
    expect(doc).not.toContain('@latest')
    expect(doc).not.toContain('github.com/Tencent/BrowserSkill/tree/')
  })
})
