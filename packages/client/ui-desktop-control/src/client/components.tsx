import type { DesktopControlUiMutation, DesktopControlUiSnapshot } from './contracts.ts'
import { en, type DesktopControlLabels } from './locales.ts'
import css from './desktop-control.module.css'
import { useEffect, useRef, useState } from 'react'

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
  readonly onMutation: (mutation: DesktopControlUiMutation) => void | Promise<void>
  readonly onRetry?: () => void | Promise<void>
  readonly onStop?: () => void | Promise<void>
  readonly labels?: DesktopControlLabels
}

function permissionLabel(value: DesktopControlUiSnapshot['permissions']['screenViewing'], labels: DesktopControlLabels): string {
  if (value === 'granted') return labels.granted
  if (value === 'denied') return labels.denied
  return labels.unknown
}

function capabilityStatus(
  capability: DesktopControlUiSnapshot['browser'],
  labels: DesktopControlLabels,
): string {
  const availability = capability.availability === 'available'
    ? labels.available
    : capability.availability === 'unavailable' ? labels.unavailable : labels.unknown
  return `${availability} · ${capability.enabled ? labels.enabled : labels.notEnabled}`
}

interface CapabilityRowProps {
  readonly icon: string
  readonly title: string
  readonly description: string
  readonly capability: DesktopControlUiSnapshot['browser']
  readonly pending: boolean
  readonly onChange: (enabled: boolean) => void
  readonly labels: DesktopControlLabels
}

function CapabilityRow(props: CapabilityRowProps) {
  return (
    <div className={css.capabilityRow}>
      <span className={css.iconWell} aria-hidden="true">{props.icon}</span>
      <div className={css.rowCopy}>
        <strong>{props.title}</strong>
        <span>{props.description}</span>
      </div>
      <span className={css.capabilityStatus} data-availability={props.capability.availability}>
        {capabilityStatus(props.capability, props.labels)}
      </span>
      <label className={css.switch}>
        <input
          aria-label={props.title}
          type="checkbox"
          checked={props.capability.enabled}
          disabled={props.capability.availability !== 'available' || props.pending}
          onChange={(event) => { props.onChange(event.currentTarget.checked) }}
        />
        <span aria-hidden="true" />
      </label>
    </div>
  )
}

export function DesktopControlSettings({
  snapshot, onMutation, onRetry, onStop, labels = en,
}: DesktopControlSettingsProps) {
  const pendingKeys = useRef(new Set<string>())
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [failure, setFailure] = useState<string | null>(null)
  const [acceleratorDraft, setAcceleratorDraft] = useState(snapshot.emergencyAccelerator)
  useEffect(() => { setAcceleratorDraft(snapshot.emergencyAccelerator) }, [snapshot.emergencyAccelerator])
  const availableCount = [snapshot.browser, snapshot.computer]
    .filter(capability => capability.availability === 'available').length
  const finish = (key: string): void => {
    pendingKeys.current.delete(key)
    setPending(new Set(pendingKeys.current))
  }
  const submit = (key: string, operation: () => void | Promise<void>): void => {
    if (pendingKeys.current.has(key)) return
    pendingKeys.current.add(key)
    setPending(new Set(pendingKeys.current))
    setFailure(null)
    try {
      const result = operation()
      if (result === undefined) {
        finish(key)
        return
      }
      void result
        .catch(() => { setFailure(labels.settingFailed) })
        .finally(() => { finish(key) })
    } catch {
      setFailure(labels.settingFailed)
      finish(key)
    }
  }
  return (
    <section className={css.settings} data-desktop-control-settings>
      <header className={css.header}>
        <div>
          <h2>{labels.section}</h2>
          <p>{labels.sectionDescription}</p>
        </div>
        <span className={css.summary}>{availableCount} {availableCount === 1
          ? labels.capabilityAvailable : labels.capabilitiesAvailable}</span>
      </header>

      <div className={css.group}>
        <CapabilityRow
          icon="◉" title={labels.browserControl} description={labels.browserDescription}
          capability={snapshot.browser} pending={pending.has('browser')} labels={labels}
          onChange={(enabled) => { submit('browser', () => onMutation({ kind: 'set-browser-enabled', enabled })) }}
        />
        <CapabilityRow
          icon="⌘" title={labels.computerControl} description={labels.computerDescription}
          capability={snapshot.computer} pending={pending.has('computer')} labels={labels}
          onChange={(enabled) => { submit('computer', () => onMutation({ kind: 'set-computer-enabled', enabled })) }}
        />
      </div>

      {snapshot.refresh.status.state === 'failed' && <div className={css.notice} role="status">
        <span>{snapshot.refresh.status.message}</span>
        {onRetry !== undefined && <button type="button" onClick={() => { submit('retry', onRetry) }}>{labels.retryStatus}</button>}
      </div>}

      <section className={css.sectionGroup} aria-labelledby="desktop-control-permissions">
        <h3 id="desktop-control-permissions">{labels.permissions}</h3>
        <div className={css.group}>
          <div className={css.detailRow}>
            <strong>{labels.screenViewing}</strong>
            <span>{permissionLabel(snapshot.permissions.screenViewing, labels)}</span>
          </div>
          <div className={css.detailRow}>
            <strong>{labels.assistiveControl}</strong>
            <span>{permissionLabel(snapshot.permissions.assistiveControl, labels)}</span>
          </div>
        </div>
      </section>
      {(snapshot.permissions.screenViewing !== 'granted' || snapshot.permissions.assistiveControl !== 'granted')
        && <p className={css.guidance}>{labels.permissionGuidance}</p>}

      <fieldset className={css.applications}>
        <legend>{labels.authorizedApps}</legend>
        {snapshot.refresh.apps.state === 'failed' && <div className={css.notice} role="status">
          <span>{snapshot.refresh.apps.message}</span>
          {onRetry !== undefined && <button type="button" onClick={() => { submit('retry', onRetry) }}>{labels.retryApps}</button>}
        </div>}
        <div className={css.appList} data-desktop-control-app-list>
          {snapshot.ordinaryApps.length === 0
            ? <p>{labels.noApps}</p>
            : snapshot.ordinaryApps.map(app => (
              <label className={css.appRow} key={app.appId}>
                <input
                  type="checkbox"
                  checked={app.allowed}
                  disabled={snapshot.computer.availability !== 'available' || pending.has(`app:${app.appId}`)}
                  onChange={(event) => { submit(`app:${app.appId}`, () => onMutation({
                    kind: 'set-app-allowed', appId: app.appId, allowed: event.currentTarget.checked,
                  })) }}
                />
                {app.name}
              </label>
            ))}
        </div>
      </fieldset>

      <label className={`${css.detailRow} ${css.shortcut}`}>
        <strong>{labels.emergencyShortcut}</strong>
        <input
          value={acceleratorDraft}
          disabled={pending.has('shortcut')}
          onChange={(event) => { setAcceleratorDraft(event.currentTarget.value) }}
          onBlur={() => {
            if (acceleratorDraft === snapshot.emergencyAccelerator) return
            submit('shortcut', async () => {
              try {
                await onMutation({ kind: 'set-emergency-accelerator', accelerator: acceleratorDraft })
              } catch (error) {
                setAcceleratorDraft(snapshot.emergencyAccelerator)
                throw error
              }
            })
          }}
        />
      </label>

      <section className={css.current} aria-labelledby="desktop-control-current">
        <div>
          <h3 id="desktop-control-current">{labels.currentControl}</h3>
          {snapshot.active === null
            ? <p>{labels.idle}</p>
            : <p><strong>{snapshot.active.agentName}</strong> · {snapshot.active.appName} · {snapshot.active.action}</p>}
        </div>
        {snapshot.active !== null && onStop !== undefined && <button
          type="button" disabled={snapshot.stopping || pending.has('stop')}
          onClick={() => { submit('stop', onStop) }}
        >{snapshot.stopping ? labels.stopping : labels.stop}</button>}
      </section>
      {failure !== null && <p className={css.notice} role="alert">{failure}</p>}
    </section>
  )
}
