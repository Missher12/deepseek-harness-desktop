import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CONTROL_SETTINGS,
  readControlSettings,
  writeControlSettings,
} from '../src/control/settings-store.ts'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-control-settings-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('control settings store', () => {
  it('accepts only the independent versioned schema and returns a frozen copy', async () => {
    const file = join(await tempRoot(), 'control.json')
    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      ordinaryAppIds: ['com.example.Editor'],
      browserEnabled: true,
      computerEnabled: false,
      emergencyAccelerator: 'CommandOrControl+Shift+F12',
    }))
    const value = await readControlSettings(file)
    expect(value).toEqual({
      schemaVersion: 1,
      ordinaryAppIds: ['com.example.Editor'],
      browserEnabled: true,
      computerEnabled: false,
      emergencyAccelerator: 'CommandOrControl+Shift+F12',
    })
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.ordinaryAppIds)).toBe(true)
  })

  it.each([
    ['unknown authority field', '{"schemaVersion":1,"ordinaryAppIds":[],"browserEnabled":false,"computerEnabled":false,"emergencyAccelerator":"F12","leaseId":"secret"}'],
    ['prototype field', '{"schemaVersion":1,"ordinaryAppIds":[],"browserEnabled":false,"computerEnabled":false,"emergencyAccelerator":"F12","__proto__":{"polluted":true}}'],
    ['coercible switch', '{"schemaVersion":1,"ordinaryAppIds":[],"browserEnabled":0,"computerEnabled":false,"emergencyAccelerator":"F12"}'],
    ['duplicate app id', '{"schemaVersion":1,"ordinaryAppIds":["app.one","app.one"],"browserEnabled":false,"computerEnabled":false,"emergencyAccelerator":"F12"}'],
    ['future schema', '{"schemaVersion":2,"ordinaryAppIds":[],"browserEnabled":false,"computerEnabled":false,"emergencyAccelerator":"F12"}'],
    ['duplicate JSON key', '{"schemaVersion":1,"ordinaryAppIds":[],"browserEnabled":true,"browserEnabled":false,"computerEnabled":false,"emergencyAccelerator":"F12"}'],
  ])('fails closed as one default record for hostile JSON: %s', async (_label, contents) => {
    const file = join(await tempRoot(), 'control.json')
    await writeFile(file, contents)
    await expect(readControlSettings(file)).resolves.toEqual(DEFAULT_CONTROL_SETTINGS)
  })

  it('does not follow a settings symlink and atomically replaces the link itself', async () => {
    const root = await tempRoot()
    const target = join(root, 'outside.json')
    const file = join(root, 'control.json')
    await writeFile(target, '{"sentinel":"must-not-change"}\n')
    await symlink(target, file)
    await expect(readControlSettings(file)).resolves.toEqual(DEFAULT_CONTROL_SETTINGS)
    await writeControlSettings(file, {
      ...DEFAULT_CONTROL_SETTINGS,
      browserEnabled: true,
    })
    expect(await readFile(target, 'utf8')).toBe('{"sentinel":"must-not-change"}\n')
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ browserEnabled: true })
  })

  it('propagates an atomic replacement failure without mutating the old record', async () => {
    const file = join(await tempRoot(), 'control.json')
    await writeFile(file, '{"old":true}\n')
    await expect(writeControlSettings(file, DEFAULT_CONTROL_SETTINGS, {
      writeAtomic: async () => { throw new Error('atomic failure') },
    })).rejects.toThrow('atomic failure')
    expect(await readFile(file, 'utf8')).toBe('{"old":true}\n')
  })
})
