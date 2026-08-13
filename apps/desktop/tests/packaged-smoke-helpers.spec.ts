import { describe, expect, it } from 'vitest'
import { descendantProcessTree, parseWindowsProcessRows } from './packaged-smoke.ts'

describe('packaged desktop process inspection', () => {
  it('parses both PowerShell single-object and array JSON', () => {
    expect(parseWindowsProcessRows('{"ProcessId":12,"ParentProcessId":4}')).toEqual([
      { processId: 12, parentProcessId: 4 },
    ])
    expect(parseWindowsProcessRows('[{"ProcessId":12,"ParentProcessId":4},{"ProcessId":13,"ParentProcessId":12}]')).toEqual([
      { processId: 12, parentProcessId: 4 },
      { processId: 13, parentProcessId: 12 },
    ])
    expect(parseWindowsProcessRows('  ')).toEqual([])
  })

  it('walks descendants once when a malformed snapshot contains a cycle', () => {
    expect(descendantProcessTree(10, [
      { processId: 11, parentProcessId: 10 },
      { processId: 12, parentProcessId: 11 },
      { processId: 10, parentProcessId: 12 },
      { processId: 99, parentProcessId: 1 },
    ])).toEqual([10, 11, 12])
  })
})
