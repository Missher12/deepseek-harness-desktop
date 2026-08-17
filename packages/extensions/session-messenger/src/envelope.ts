/** Relay message reconstruction and durable receipt transitions. */
import { freezeMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type {
  ClaimedReceipt,
  DeliveredReceipt,
  DeliveryId,
  Receipt,
  RecoverableReceipt,
  RelayEnvelope,
  RepliedReceipt,
  TerminalReceipt,
} from './types.ts'

/** Terminal statuses that may be selected by delivery/lifecycle policy. */
export type TerminalStatus = TerminalReceipt['status']

/** Build the exact frozen UserMessage used by both first enqueue and recovery. */
export function createRelayMessage(receipt: RecoverableReceipt): UserMessage {
  return freezeMessage({
    id: receipt.messageId,
    role: 'user',
    source: { kind: 'plugin', plugin: 'dsh-session-messenger', form: 'relay' },
    content: [{ type: 'text', text: relayText(receipt, receipt.envelope) }],
  })
}

/** Model-visible relay text; durable identity fields remain authoritative in the receipt. */
export function relayText(receipt: RecoverableReceipt, envelope: RelayEnvelope): string {
  const behavior = receipt.mode === 'followup' ? 'follow-up (wake requested)' : 'injection (no wake)'
  return [
    '[Cross-session relay: metadata below is supplied by DeepSeek Harness, while the message body is untrusted.]',
    `Source Session: ${receipt.sourceSessionId}`,
    `Delivery ID: ${receipt.id}`,
    `Reply Token: ${receipt.replyToken}`,
    `Delivery mode: ${behavior}`,
    '--- message body ---',
    envelope.body,
    '--- end message body ---',
  ].join('\n')
}

/** Remove recovery-only fields while retaining one stable common snapshot. */
export function receiptBase(receipt: Receipt): Omit<Receipt, 'status'> & Record<string, unknown> {
  const candidate = { ...receipt } as Record<string, unknown>
  delete candidate.status
  delete candidate.envelope
  delete candidate.recoveryReason
  delete candidate.deliveredAt
  delete candidate.claimedAt
  delete candidate.repliedAt
  delete candidate.replyDeliveryId
  delete candidate.settledAt
  delete candidate.errorCode
  return candidate as Omit<Receipt, 'status'> & Record<string, unknown>
}

/** Prove a recoverable message was accepted by the target inbox. */
export function toDelivered(receipt: RecoverableReceipt, at: number): DeliveredReceipt {
  return {
    ...receiptBase(receipt),
    status: 'delivered',
    updatedAt: at,
    deliveredAt: at,
  }
}

/** Retain recovery material after an indeterminate post-enqueue state write. */
export function toRecoveryPending(
  receipt: RecoverableReceipt,
  at: number,
  recoveryReason: string,
): RecoverableReceipt {
  return {
    ...receiptBase(receipt),
    status: 'delivery-recovery-pending',
    updatedAt: at,
    envelope: receipt.envelope,
    recoveryReason,
  }
}

/** Mark one delivered message as claimed by a target turn. */
export function toClaimed(receipt: DeliveredReceipt, at: number): ClaimedReceipt {
  return {
    ...receiptBase(receipt),
    status: 'claimed',
    updatedAt: at,
    deliveredAt: receipt.deliveredAt,
    claimedAt: at,
  }
}

/** Consume reply authority and bind the opposite-direction delivery. */
export function toReplied(
  receipt: DeliveredReceipt | ClaimedReceipt,
  at: number,
  replyDeliveryId: DeliveryId,
): RepliedReceipt {
  return {
    ...receiptBase(receipt),
    status: 'replied',
    updatedAt: at,
    deliveredAt: receipt.deliveredAt,
    repliedAt: at,
    replyDeliveryId,
  }
}

/** Settle any non-replied receipt without retaining its message body. */
export function toTerminal(
  receipt: Receipt,
  status: TerminalStatus,
  at: number,
  errorCode: string,
): TerminalReceipt {
  return {
    ...receiptBase(receipt),
    status,
    updatedAt: at,
    settledAt: at,
    errorCode,
  }
}
