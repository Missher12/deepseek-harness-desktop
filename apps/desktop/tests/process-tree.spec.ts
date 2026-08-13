import { describe, expect, it, vi } from 'vitest'
import { terminateProcessTree } from '../src/harness/process-tree.ts'

describe('terminateProcessTree', () => {
  it('force-terminates only the exact positive Windows PID and descendants', () => {
    const run = vi.fn()

    terminateProcessTree(4321, 'force', 'win32', { run })

    expect(run).toHaveBeenCalledWith('taskkill', ['/PID', '4321', '/T', '/F'])
  })

  it('contains absent Windows trees and ignores non-positive PIDs', () => {
    const run = vi.fn(() => { throw new Error('already gone') })

    expect(() => { terminateProcessTree(4321, 'force', 'win32', { run }) }).not.toThrow()
    terminateProcessTree(0, 'force', 'win32', { run })
    terminateProcessTree(-1, 'force', 'win32', { run })

    expect(run).toHaveBeenCalledOnce()
  })
})
