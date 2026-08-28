import { describe, expect, it } from 'vitest'
import { mapComputerControlPermissions } from '../src/control/permissions.ts'

describe('Computer Control permission presentation mapping', () => {
  it('maps granted permissions without a settings action', () => {
    expect(mapComputerControlPermissions({ viewing: 'granted', assistive: 'granted', supported: true })).toEqual({
      supported: true,
      screenViewing: { state: 'granted', manualSettings: undefined },
      assistiveControl: { state: 'granted', manualSettings: undefined },
    })
  })

  it('maps denied permissions only to manual System Settings targets', () => {
    expect(mapComputerControlPermissions({ viewing: 'denied', assistive: 'denied', supported: true })).toEqual({
      supported: true,
      screenViewing: { state: 'denied', manualSettings: 'screen-recording' },
      assistiveControl: { state: 'denied', manualSettings: 'accessibility' },
    })
  })

  it('keeps unsupported and unknown status fail closed', () => {
    expect(mapComputerControlPermissions({ viewing: 'unknown', assistive: 'unknown', supported: false })).toEqual({
      supported: false,
      screenViewing: { state: 'unknown', manualSettings: undefined },
      assistiveControl: { state: 'unknown', manualSettings: undefined },
    })
  })
})
