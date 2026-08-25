import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  composeEntries,
  initProfile,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  readProfileManifest,
  resolveProfileDir,
  writeProfileManifest,
} from '@deepseek-ai/dsh-app-boot'

const PACKAGE_NAME = '@deepseek-ai/dsh-lark'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('real Profile install and removal composition', () => {
  it('adds dependency and bundle atomically, disables independently, then removes without touching Sessions', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-lark-profile-'))
    roots.push(home)
    const profileDir = resolveProfileDir('fixture', home)
    initProfile(profileDir, [])
    const sessionDir = join(home, 'sessions', 'session-a')
    const sessionFile = join(sessionDir, 'events.jsonl')
    await mkdir(sessionDir, { recursive: true })
    await writeFile(sessionFile, '{"type":"user/message"}\n')

    const packageRoot = new URL('..', import.meta.url).pathname
    const installedPackage = join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-lark')
    await mkdir(join(profileDir, 'node_modules', '@deepseek-ai'), { recursive: true })
    await symlink(packageRoot, installedPackage, 'junction')

    const installed = readProfileManifest('test', profileDir)
    installed.dependencies = { [PACKAGE_NAME]: 'file:fixture.tgz' }
    installed.dsh = { profile: { bundles: [PACKAGE_NAME] } }
    writeProfileManifest(profileDir, installed)

    const installAnchorDir = join(home, 'install')
    await mkdir(installAnchorDir, { recursive: true })
    const installAnchor = join(installAnchorDir, 'package.json')
    await writeFile(installAnchor, '{"name":"fixture-dsh"}\n')
    let profile = loadProfile('test', 'fixture', installAnchor, home)
    expect(profile.layers.map(layer => layer.packageName)).toEqual([PACKAGE_NAME])
    expect(composeEntries(profile.layers.map(layer => layer.patches))).toEqual([
      { id: 'lark', name: PACKAGE_NAME },
    ])

    await writeFile(join(profileDir, PROFILE_PATCH_FILENAME), '- id: lark\n  disabled: true\n')
    profile = loadProfile('test', 'fixture', installAnchor, home)
    expect(composeEntries([...profile.layers.map(layer => layer.patches), profile.patches]))
      .toEqual([{ id: 'lark', name: PACKAGE_NAME, disabled: true }])

    const removed = readProfileManifest('test', profileDir)
    removed.dependencies = {}
    removed.dsh = { profile: { bundles: [] } }
    writeProfileManifest(profileDir, removed)
    await rm(installedPackage)
    await writeFile(join(profileDir, PROFILE_PATCH_FILENAME), '[]\n')
    profile = loadProfile('test', 'fixture', installAnchor, home)
    expect(profile.layers).toEqual([])
    expect(composeEntries([profile.patches])).toEqual([])
    await expect(access(sessionFile)).resolves.toBeUndefined()
    await expect(readFile(sessionFile, 'utf8')).resolves.toBe('{"type":"user/message"}\n')
  })
})
