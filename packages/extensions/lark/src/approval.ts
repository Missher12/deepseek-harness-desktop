interface ApprovalResponder {
  respond(message: unknown): Promise<
    | { accepted: true }
    | { accepted: false; reason: 'not-pending' | 'bad-response' }
  >
}

/** Correlation and bounded outcome accepted from one Feishu approval action. */
export interface ApprovalAnswer {
  rpcId: string
  sessionId: string
  approvalId: string
  action: 'allow-once' | 'deny'
}

/** Reuses the existing ApiProxy pending-approval winner and audit correlation. */
export class ApprovalBridge {
  constructor(private readonly proxy: ApprovalResponder) {}

  /**
   * Submit one response into the existing Harness approval race.
   * @param input - Correlated pending approval and allow-once or deny choice.
   * @returns The ApiProxy winner result.
   */
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
