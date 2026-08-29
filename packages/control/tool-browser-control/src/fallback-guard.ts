import type { Context } from '@deepseek-ai/cordis'
import { BrowserControlError, type SessionIdType } from '@deepseek-ai/dsh-browser-control'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

const TERMINAL_BROWSER_ERRORS = new Set([
  'NOT_SUPPORTED', 'UNAUTHORIZED', 'PERMISSION_DENIED', 'POLICY_DENIED',
  'CONTROL_DISABLED', 'TARGET_NOT_AUTHORIZED', 'APPROVAL_DENIED',
  'QUOTA_EXCEEDED', 'BINARY_MISMATCH',
])
const DIRECT_EXECUTION_FALLBACKS = new Set([
  'bash', 'pwsh', 'run_code', 'terminal_open', 'terminal_send',
])
type BrowserFallbackState = 'recoverable' | 'terminal'

/** Per-turn execution guard that prevents an official browser failure from being bypassed through code or a shell. */
export class BrowserFallbackGuard {
  readonly #blocked = new Map<string, BrowserFallbackState>()

  /**
   * Install a monotonic execution guard and scoped lifecycle listeners on the BrowserControl provider fiber.
   * @param ctx active provider-scoped Cordis context.
   */
  constructor(ctx: Context) {
    ctx.tools.guard(exec => this.#guard(exec))
    ctx.on('agent/turn-stopping', ({ agent }) => { this.#blocked.delete(agent.session.id) })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/end') this.#blocked.delete(session.id)
    })
    ctx.on('session/disposed', (session) => { this.#blocked.delete(session.id) })
    ctx.effect(() => () => { this.#blocked.clear() }, 'tool-browser-control: clear direct-fallback denials')
  }

  /**
   * Mark one official session after any BrowserControl failure.
   * @param sessionId official Harness session that observed the failure.
   * @param error exact provider error before model-facing redaction.
   */
  failed(sessionId: SessionIdType, error: unknown): void {
    if (error instanceof BrowserControlError) {
      const next = TERMINAL_BROWSER_ERRORS.has(error.code) ? 'terminal' : 'recoverable'
      if (this.#blocked.get(sessionId) !== 'terminal') this.#blocked.set(sessionId, next)
    }
  }

  /**
   * Clear a recoverable denial only after an official browser snapshot or action succeeds.
   * @param sessionId official Harness session whose owned route recovered.
   */
  succeeded(sessionId: SessionIdType): void {
    if (this.#blocked.get(sessionId) === 'recoverable') this.#blocked.delete(sessionId)
  }

  /**
   * Clear the per-turn fallback denial only after an awaited official Stop succeeds.
   * @param sessionId - official Session whose BrowserControl cleanup reached quiescence.
   */
  stopped(sessionId: SessionIdType): void {
    this.#blocked.delete(sessionId)
  }

  #guard(exec: Readonly<ToolExecution>): string | undefined {
    const sessionId = exec.agent?.session.id
    if (sessionId !== undefined && this.#blocked.has(sessionId)
      && DIRECT_EXECUTION_FALLBACKS.has(exec.name)) {
      return 'Direct browser-control fallback is disabled after an official BrowserControl failure. Use browser_stop and the official browser tools, or report the failure.'
    }
    return undefined
  }
}
