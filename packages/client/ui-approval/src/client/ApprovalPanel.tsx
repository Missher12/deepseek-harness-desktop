/** Composer takeover for one pending approval waterfall. */
import { useState, type ReactNode } from 'react'
import { Button, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ApprovalComposerProps, PendingApproval } from './contract/slots.ts'
import css from './ApprovalPanel.module.css'

/**
 * Render one pending approval and its optional Tool-owned detail.
 * @param props - selector-matched request and standard Slot props.
 * @returns The approval composer takeover.
 */
export function ApprovalPanel(props: ApprovalComposerProps) {
  const approval = props.matched
  const detail = approval.callId === undefined
    ? null
    : props.renderSlot('conversation.approval.detail', { callId: approval.callId })
  return <ApprovalFlow key={approval.key} pending={approval} detail={detail} t={props.t} />
}

function ApprovalFlow({ pending, detail, t }: {
  pending: PendingApproval
  detail: ReactNode
  t: ApprovalComposerProps['t']
}) {
  const [busy, setBusy] = useState(false)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [fullAccessEnabled, setFullAccessEnabled] = useState(false)
  const [failure, setFailure] = useState<'permission' | 'response' | 'response-after-full-access' | null>(null)
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
    if (busy) return
    setAcknowledged(false)
    setConfirmationOpen(false)
  }
  const enableFullAccess = (): void => {
    if (busy || !acknowledged) return
    setConfirmationOpen(false)
    setAcknowledged(false)
    setBusy(true)
    setFailure(null)
    void pending.enableSessionFullAccess()
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
    ? t('fullAccessFailed')
    : failure === 'response-after-full-access'
      ? t('retryAfterFullAccess')
      : failure === 'response'
        ? t('responseFailed')
        : null
  return (
    <div className={css.root} data-approval-key={pending.key}>
      <div className={css.card}>
        <div className={css.strip}><span className={css.dot} />{t('waiting')}</div>
        <div
          className={css.body}
          data-approval-scroll=""
          tabIndex={0}
          role="group"
          aria-label={t('detail.aria')}
        >
          <div className={css.headline}>{pending.reason ?? t('escalation', { toolName: pending.toolName })}</div>
          {detail !== null && <div className={css.command}>{detail}</div>}
        </div>
        <div className={css.feedback} role="status" aria-live="polite">{feedback}</div>
        <div className={css.actionRow}>
          <Button variant="outline" className={css.reject} disabled={busy} onClick={() => { answer('rejected') }}>
            {t('reject')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => { answer('allowed-once') }}>
            {t('allowOnce')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={openFullAccessConfirmation}>
            {fullAccessEnabled ? t('retryCurrent') : t('allowSession')}
          </Button>
        </div>
      </div>
      <RiskConfirmation
        open={confirmationOpen}
        title={t('confirm.title')}
        description={t('confirm.description')}
        acknowledgeLabel={t('confirm.acknowledge')}
        cancelLabel={t('confirm.cancel')}
        closeLabel={t('confirm.cancel')}
        confirmLabel={t('confirm.enable')}
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={closeFullAccessConfirmation}
        onConfirm={enableFullAccess}
      />
    </div>
  )
}
