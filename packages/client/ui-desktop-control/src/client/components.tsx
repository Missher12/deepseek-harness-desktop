import type { DesktopControlUiMutation, DesktopControlUiSnapshot } from './contracts.ts'
import { en, type DesktopControlLabels } from './locales.ts'
import css from './desktop-control.module.css'

export interface DesktopControlCapsuleProps {
  readonly snapshot: DesktopControlUiSnapshot
  readonly onStop: () => void
  readonly labels?: DesktopControlLabels
}

export function DesktopControlCapsule({ snapshot, onStop, labels = en }: DesktopControlCapsuleProps) {
  if (snapshot.active === null) return null
  return (
    <section className={css.capsule} aria-label={labels.controlActive}>
      <span className={css.agent}>{snapshot.active.agentName}</span>
      <span>{snapshot.active.appName}</span>
      <span className={css.action}>{snapshot.active.action}</span>
      <button type="button" disabled={snapshot.stopping} onClick={onStop}>
        {snapshot.stopping ? labels.stopping : labels.stop}
      </button>
    </section>
  )
}

export interface DesktopControlSettingsProps {
  readonly snapshot: DesktopControlUiSnapshot
  readonly onMutation: (mutation: DesktopControlUiMutation) => void
  readonly labels?: DesktopControlLabels
}

function permissionLabel(value: DesktopControlUiSnapshot['permissions']['screenViewing'], labels: DesktopControlLabels): string {
  if (value === 'granted') return labels.granted
  if (value === 'denied') return labels.denied
  return labels.unknown
}

export function DesktopControlSettings({ snapshot, onMutation, labels = en }: DesktopControlSettingsProps) {
  return (
    <section className={css.settings} data-desktop-control-settings>
      <header>
        <div><h2>{labels.section}</h2><p>{snapshot.supported ? labels.loaded : labels.unavailable}</p></div>
        <div className={css.toggles}>
          <label className={css.toggle}>
            <input
              type="checkbox"
              checked={snapshot.browserEnabled}
              onChange={(event) => { onMutation({ kind: 'set-browser-enabled', enabled: event.currentTarget.checked }) }}
            />
            {labels.browserControl}
          </label>
          <label className={css.toggle}>
            <input
              type="checkbox"
              checked={snapshot.computerEnabled}
              disabled={!snapshot.supported}
              onChange={(event) => { onMutation({ kind: 'set-computer-enabled', enabled: event.currentTarget.checked }) }}
            />
            {labels.computerControl}
          </label>
        </div>
      </header>
      <div className={css.permissions}>
        <p><strong>{labels.screenViewing}</strong><span>{permissionLabel(snapshot.permissions.screenViewing, labels)}</span></p>
        <p><strong>{labels.assistiveControl}</strong><span>{permissionLabel(snapshot.permissions.assistiveControl, labels)}</span></p>
      </div>
      {(snapshot.permissions.screenViewing !== 'granted' || snapshot.permissions.assistiveControl !== 'granted')
        && <p className={css.guidance}>{labels.permissionGuidance}</p>}
      <fieldset>
        <legend>{labels.authorizedApps}</legend>
        {snapshot.ordinaryApps.length === 0
          ? <p>{labels.noApps}</p>
          : snapshot.ordinaryApps.map(app => (
            <label key={app.appId}>
              <input
                type="checkbox"
                checked={app.allowed}
                disabled={!snapshot.supported}
                onChange={(event) => { onMutation({ kind: 'set-app-allowed', appId: app.appId, allowed: event.currentTarget.checked }) }}
              />
              {app.name}
            </label>
          ))}
      </fieldset>
      <label className={css.shortcut}>
        {labels.emergencyShortcut}
        <input
          value={snapshot.emergencyAccelerator}
          disabled={!snapshot.supported}
          onChange={(event) => { onMutation({ kind: 'set-emergency-accelerator', accelerator: event.currentTarget.value }) }}
        />
      </label>
    </section>
  )
}
