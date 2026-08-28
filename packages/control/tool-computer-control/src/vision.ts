/** Exact-route image capability checks shared by screenshots and coordinate actions. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-llm'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

/** Return true only when the active route can consume a stored PNG attachment. */
export async function routeCanSeeImages(ctx: Context, exec: ToolRunContext): Promise<boolean> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined || !attachments.imageLimits.mediaTypes.includes('image/png')) return false
  const llm = ctx.get('llm')
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  if (llm === undefined || provider === undefined || model === undefined) return false
  try {
    const info = await llm.resolveModelInfo(provider, model, exec.signal)
    return info.inputModalities?.includes('image') === true
  } catch (error: unknown) {
    exec.signal.throwIfAborted()
    void error
    return false
  }
}
