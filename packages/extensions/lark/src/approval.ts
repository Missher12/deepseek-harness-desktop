interface ApprovalResponder {
  respond(message: unknown): Promise<
    | { accepted: true }
    | { accepted: false; reason: 'not-pending' | 'bad-response' }
  >
}

export interface ApprovalAnswer {
  rpcId: string
  sessionId: string
  approvalId: string
  action: 'allow-once' | 'deny'
}

/** Reuses the existing ApiProxy pending-approval winner and audit correlation. */
export class ApprovalBridge {
  constructor(private readonly proxy: ApprovalResponder) {}

  answer(input: ApprovalAnswer): ReturnType<ApprovalResponder['respond']> {
    return this.proxy.respond({
      type: 'client-response',
      rpcId: input.rpcId,
      result: {
        ok: true,
        value: {
          sessionId: input.sessionId,
          approvalId: input.approvalId,
          outcome: input.action === 'allow-once' ? 'allowed-once' : 'rejected',
        },
      },
    })
  }
}
