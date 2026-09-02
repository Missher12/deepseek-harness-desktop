// ApprovalPanel: the composer-takeover approval prompt (designer draft
// approval.png), registered as a selector-routed entry of the
// conversation-declared composer chain. While an approval question is
// pending, this panel occupies the composer slot in place of the InputBar:
// an amber "Waiting for approval" strip on the card top, the model's
// justification as the headline, the paired command in muted code text, and
// a right-aligned reject/allow-once/session-access action row. Justification and command are
// unbounded model text, so they scroll inside the card at the shared composer
// cap (`data-approval-scroll`) and the action row stays outside it — the
// buttons must be reachable no matter how long the command is.
// One-shot: the buttons disable after a response or permission command starts,
// and the panel leaves (the InputBar returns) on the broadcast resolved frame.

import { useMemo, useState } from 'react'
import { Button, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RunningToolCall } from '@deepseek-ai/dsh-client-runtime/client'
import { PendingApproval, type ApprovalComposerProps } from '../contract/slots.ts'
import { rootToolCall } from '../chat/tool-node-reader.ts'
import css from './ApprovalPanel.module.css'

/** Extract the shell command from an approval's paired running call (bash-family args carry `command`); undefined hides the line. */
export function commandOf(call: RunningToolCall | undefined): string | undefined {
  if (call === undefined) return undefined
  try {
    const args = JSON.parse(call.argsRaw) as Record<string, unknown>
    return typeof args.command === 'string' ? args.command : undefined
  } catch {
    // Unparseable model args: the panel still renders, just without the command line.
    return undefined
  }
}

/**
 * Composer takeover boundary: mints the domain face on the carrier's stable
 * identity and remounts the flow per request key, so the one-shot answered
 * latch never leaks to the next pending approval.
 * @param props - the selector-matched pending approval carrier plus the framework standard kit.
 * @returns The approval prompt for this request.
 */
export function ApprovalPanel(props: ApprovalComposerProps) {
  const approval = useMemo(() => new PendingApproval(props.matched), [props.matched])
  const commandLine = props.useSession((snapshot) => {
    if (approval.callId === undefined) return undefined
    const root = rootToolCall(snapshot, approval.callId)
    if (root === undefined) return undefined
    return root.callId === approval.callId && !('kind' in root) ? commandOf(root) : undefined
  })
  return (
    <ApprovalFlow
      key={approval.key}
      pending={approval}
      runSessionCommand={props.runSessionCommand}
      t={props.t}
      {...commandLine === undefined ? {} : { commandLine }}
    />
  )
}

type ApprovalFailure = 'permission' | 'response' | 'response-after-full-access'

function ApprovalFlow({ pending, commandLine, runSessionCommand, t }: {
  pending: PendingApproval
  commandLine?: string
  runSessionCommand: ApprovalComposerProps['runSessionCommand']
  t: ApprovalComposerProps['t']
}) {
  // The panel leaves only when the resolved frame lands. Local state prevents
  // duplicate commands/responses while preserving an explicit retry when a
  // transport rejects either step.
  const [busy, setBusy] = useState(false)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [fullAccessEnabled, setFullAccessEnabled] = useState(false)
  const [failure, setFailure] = useState<ApprovalFailure | null>(null)

  const answer = (outcome: 'allowed-once' | 'rejected', afterFullAccess = false): void => {
    setBusy(true)
    setFailure(null)
    void pending.answer(outcome).catch(() => {
      setBusy(false)
      setFailure(afterFullAccess ? 'response-after-full-access' : 'response')
    })
  }

  const openFullAccessConfirmation = (): void => {
    if (fullAccessEnabled) {
      answer('allowed-once', true)
      return
    }
    setFailure(null)
    setAcknowledged(false)
    setConfirmationOpen(true)
  }

  const closeFullAccessConfirmation = (): void => {
    setAcknowledged(false)
    setConfirmationOpen(false)
  }

  const enableFullAccess = (): void => {
    if (busy || !acknowledged) return
    closeFullAccessConfirmation()
    setBusy(true)
    setFailure(null)
    void runSessionCommand('/permission danger-full-access')
      .catch(() => false)
      .then(async (changed) => {
        if (!changed) {
          setBusy(false)
          setFailure('permission')
          return
        }
        setFullAccessEnabled(true)
        try {
          await pending.answer('allowed-once')
        } catch {
          setBusy(false)
          setFailure('response-after-full-access')
        }
      })
  }

  const feedback = failure === 'permission'
    ? t('approval.fullAccessFailed')
    : failure === 'response-after-full-access'
      ? t('approval.retryAfterFullAccess')
      : failure === 'response'
        ? t('approval.responseFailed')
        : null

  return (
    <div className={css.root} data-approval-key={pending.key}>
      <div className={css.card}>
        <div className={css.strip}><span className={css.dot} />{t('approval.waiting')}</div>
        {/* Tab stop: the region scrolls once the command passes the cap and
            holds nothing focusable of its own, so without one a keyboard-only
            user cannot reach the command's tail before answering. */}
        <div className={css.body} data-approval-scroll="" tabIndex={0} role="group" aria-label={t('approval.detail.aria')}>
          <div className={css.headline}>{pending.reason ?? t('approval.escalation', { toolName: pending.toolName })}</div>
          {commandLine !== undefined && <div className={css.command}>{commandLine}</div>}
        </div>
        <div className={css.feedback} role="status" aria-live="polite">{feedback}</div>
        <div className={css.actionRow}>
          <Button variant="outline" className={css.reject} disabled={busy} onClick={() => { answer('rejected') }}>
            {t('approval.reject')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => { answer('allowed-once') }}>
            {t('approval.allowOnce')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={openFullAccessConfirmation}>
            {fullAccessEnabled ? t('approval.retryCurrent') : t('approval.allowSession')}
          </Button>
        </div>
      </div>
      <RiskConfirmation
        open={confirmationOpen}
        title={t('access.confirm.title')}
        description={t('access.confirm.description')}
        acknowledgeLabel={t('access.confirm.acknowledge')}
        cancelLabel={t('access.confirm.cancel')}
        confirmLabel={t('access.confirm.enable')}
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={closeFullAccessConfirmation}
        onConfirm={enableFullAccess}
      />
    </div>
  )
}
