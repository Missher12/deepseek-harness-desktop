import type { ComputerStatusResult } from '@deepseek-ai/dsh-desktop-control-protocol'

export type MacPrivacySettingsTarget = 'screen-recording' | 'accessibility'

export interface ComputerPermissionPresentation {
  readonly state: ComputerStatusResult['viewing']
  readonly manualSettings: MacPrivacySettingsTarget | undefined
}

export interface ComputerControlPermissionPresentation {
  readonly supported: boolean
  readonly screenViewing: ComputerPermissionPresentation
  readonly assistiveControl: ComputerPermissionPresentation
}

/** Pure fail-closed presentation mapping; callers must never trigger a permission prompt. */
export function mapComputerControlPermissions(
  status: ComputerStatusResult,
): ComputerControlPermissionPresentation {
  const manualSettings = (
    state: ComputerStatusResult['viewing'],
    target: MacPrivacySettingsTarget,
  ): MacPrivacySettingsTarget | undefined => status.supported && state === 'denied' ? target : undefined

  return {
    supported: status.supported,
    screenViewing: {
      state: status.viewing,
      manualSettings: manualSettings(status.viewing, 'screen-recording'),
    },
    assistiveControl: {
      state: status.assistive,
      manualSettings: manualSettings(status.assistive, 'accessibility'),
    },
  }
}
