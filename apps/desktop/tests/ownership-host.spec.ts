import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findConflictingHarness } from '../src/harness/ownership.ts'

const execFile = vi.hoisted(() => vi.fn<(
  file: string,
  args: readonly string[],
  options: { encoding: string; maxBuffer: number },
  callback: (error: NodeJS.ErrnoException | null, stdout: string) => void,
) => void>())

vi.mock('node:child_process', () => ({ execFile }))

const harnessHome = '/fixture/.dsh'
const webProcess = { pid: 91, command: '/usr/local/bin/dsh web' }

function discover(platform: NodeJS.Platform) {
  return findConflictingHarness(harnessHome, {
    platform,
    listProcesses: async () => [webProcess],
    canonicalize: async path => path,
    ownPid: 10,
  })
}

describe('host open-file discovery', () => {
  beforeEach(() => { execFile.mockReset() })

  it.each([
    { platform: 'linux' as const, availableLsof: '/usr/bin/lsof' },
    { platform: 'darwin' as const, availableLsof: '/usr/sbin/lsof' },
  ])('detects a shared Harness home using the executable installed on $platform', async ({
    platform,
    availableLsof,
  }) => {
    execFile.mockImplementation((file, _args, _options, callback) => {
      if (file !== availableLsof) {
        callback(Object.assign(new Error('Executable missing'), { code: 'ENOENT' }), '')
        return
      }
      callback(null, `p91\nn${harnessHome}/settings.yaml\n`)
    })

    await expect(discover(platform)).resolves.toEqual(webProcess)
    expect(execFile).toHaveBeenCalledWith(
      availableLsof,
      ['-Fn', '-p', '91'],
      expect.objectContaining({ encoding: 'utf8' }),
      expect.any(Function),
    )
  })

  it('allows a Linux process with no open files reported', async () => {
    execFile.mockImplementation((_file, _args, _options, callback) => {
      callback(Object.assign(new Error('No matching files'), { code: '1' }), '')
    })

    await expect(discover('linux')).resolves.toBeUndefined()
  })

  it('allows another Linux Harness home after inspecting its actual open-file output', async () => {
    execFile.mockImplementation((_file, _args, _options, callback) => {
      callback(null, 'p91\nn/other/.dsh/settings.yaml\n')
    })

    await expect(discover('linux')).resolves.toBeUndefined()
    expect(execFile).toHaveBeenCalledOnce()
  })

  it('propagates a Linux inspection failure instead of treating it as an empty result', async () => {
    execFile.mockImplementation((_file, _args, _options, callback) => {
      callback(Object.assign(new Error('Inspection denied'), { code: 'EACCES' }), '')
    })

    await expect(discover('linux')).rejects.toThrow('Inspection denied')
  })
})
