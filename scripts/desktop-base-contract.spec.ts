import { expect, it } from 'vitest'
import { createDesktopBaseSmokeDescriptor, validateDesktopBaseSmokeDescriptor } from './desktop-base-contract.ts'
it('retains fixed runtime requirements and the real 0.5.5 baseline', () => {
  const descriptor = createDesktopBaseSmokeDescriptor('0.6.0', 'win32', ['@deepseek-ai/dsh-base'])
  expect(validateDesktopBaseSmokeDescriptor(descriptor)).toEqual(descriptor)
  expect(descriptor.requiredPaths).toContain('resources/desktop-helper/node.exe')
  expect(descriptor.baseline).toMatchObject({ desktopVersion: '0.5.5', harnessVersion: '0.1.3-alpha.1' })
})
it.each(['requiredPaths', 'requiredPackages', 'baseline', 'officialSourceSha', 'coreRoot'])('rejects reduced or substituted %s', (key) => {
  const descriptor = { ...createDesktopBaseSmokeDescriptor('0.6.0', 'win32', []) } as Record<string, unknown>
  descriptor[key] = key.startsWith('required') ? [] : 'wrong'
  expect(() => validateDesktopBaseSmokeDescriptor(descriptor)).toThrow()
})

it('selects the released Linux 0.5.7 commit without changing Mac or Windows baselines', () => {
  const linux = createDesktopBaseSmokeDescriptor('0.6.0', 'linux', [])
  expect(linux.baseline).toEqual({ desktopVersion: '0.5.7', harnessVersion: '0.1.3-alpha.1', sourceSha: '7f544cd31c43f239c09c3a209ae0d05fe677c710' })
  expect(validateDesktopBaseSmokeDescriptor(linux)).toEqual(linux)
  const mac = createDesktopBaseSmokeDescriptor('0.6.0', 'darwin', [])
  expect(mac.baseline.desktopVersion).toBe('0.5.5')
  expect(() => validateDesktopBaseSmokeDescriptor({ ...linux, baseline: mac.baseline })).toThrow()
  expect(() => validateDesktopBaseSmokeDescriptor({ ...mac, baseline: linux.baseline })).toThrow()
  expect(() => validateDesktopBaseSmokeDescriptor({ ...linux, baseline: { ...linux.baseline, sourceSha: '41bf507' + '0'.repeat(33) } })).toThrow()
})
