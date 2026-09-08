import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { assertLinuxSandbox, type LinuxSandboxObservation } from './linux-desktop-sandbox.ts'

const valid: LinuxSandboxObservation = {
  mainCommand: ['/opt/DeepSeek Harness/deepseek-harness'],
  rendererCommand: ['/opt/DeepSeek Harness/deepseek-harness', '--type=renderer'],
  rendererStatus: 'NoNewPrivs:\t1\nSeccomp:\t2\n',
  mainUserNamespace: 'user:[100]',
  rendererUserNamespace: 'user:[101]',
}

describe('Linux native sandbox acceptance', () => {
  it('accepts a sandboxed renderer with independent kernel evidence', () => {
    expect(() => assertLinuxSandbox(valid)).not.toThrow()
  })
  it.each([
    { mainCommand: ['app', '--no-sandbox'] },
    { rendererCommand: ['app', '--type=renderer', '--disable-seccomp-filter-sandbox'] },
    { rendererCommand: ['app', '--type=gpu-process'] },
    { rendererStatus: 'NoNewPrivs:\t0\nSeccomp:\t2\n' },
    { rendererStatus: 'NoNewPrivs:\t1\nSeccomp:\t0\n' },
    { rendererUserNamespace: 'user:[100]' },
    { rendererUserNamespace: '' },
  ])('rejects incomplete or bypassed isolation: %j', (change) => {
    expect(() => assertLinuxSandbox({ ...valid, ...change })).toThrow()
  })
  it('ships both x64 formats without the builder default sandbox bypass', () => {
    const configuration = yaml.load(readFileSync(
      new URL('../apps/desktop/electron-builder.linux.yml', import.meta.url), 'utf8',
    )) as {
      extends: string
      linux: { executableArgs: string[]; target: Array<{ target: string; arch: string[] }> }
      appImage: { executableArgs: string[] }
      deb: { appArmorProfile: string }
    }
    expect(configuration.extends).toBe('./electron-builder.yml')
    expect(configuration.linux.target).toEqual([
      { target: 'deb', arch: ['x64'] }, { target: 'AppImage', arch: ['x64'] },
    ])
    expect(configuration.linux.executableArgs).toEqual([])
    expect(configuration.appImage.executableArgs).toEqual([])
    expect(configuration.deb.appArmorProfile).toBe('build/linux/apparmor-profile')
  })
})
