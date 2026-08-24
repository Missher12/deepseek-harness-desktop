import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { arbitrate, renderBrainContext } from './arbiter.ts'
import type { BrainContribution, BrainProvider, PreparedBrainBatch } from './contracts.ts'

interface PreparedProvider {
  provider: BrainProvider
  batch: PreparedBrainBatch
  items: readonly BrainContribution[]
}

/** Inputs that determine whether and how one accepted pre-step receives recall. */
export interface BrainPreStepInput {
  decision: PreStepDecision
  providers: readonly BrainProvider[]
  projectKey: string
  sessionId: string
  turn: number
  topLevel: boolean
  step: number
  signal: AbortSignal
  timeoutMs: number
  maxItems: number
  maxBytes: number
}

/** Best-effort cancellation cannot become a conversation failure. */
async function cancelQuietly(batch: PreparedBrainBatch): Promise<void> {
  try {
    await batch.cancel()
  } catch {
    // Provider cleanup is isolated from the model step.
  }
}

/** Race a provider against the shared deadline and cancel any late result. */
async function prepareWithinSignal(
  provider: BrainProvider,
  projectKey: string,
  sessionId: string,
  turn: number,
  query: string,
  signal: AbortSignal,
): Promise<PreparedProvider | undefined> {
  const operation = Promise.resolve().then(() => provider.prepare({
    projectKey,
    sessionId,
    turn,
    query,
    signal,
  }))
  /* v8 ignore next 4 -- pre-aborted turns are rejected, and the fresh deadline
   * cannot abort synchronously before this check. */
  if (signal.aborted) {
    void operation.then(cancelQuietly, () => undefined)
    return undefined
  }

  const aborted = Promise.withResolvers<never>()
  const onAbort = (): void => { aborted.reject(signal.reason) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const batch = await Promise.race([operation, aborted.promise])
    const items = arbitrate(
      batch.items.filter(item => item.providerId === provider.id),
      { maxItems: Number.MAX_SAFE_INTEGER, maxBytes: provider.byteBudget },
    )
    return { provider, batch, items }
  } catch {
    void operation.then(cancelQuietly, () => undefined)
    return undefined
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** Extract only direct-user text from the accepted batch. */
function directUserQuery(messages: readonly UserMessage[]): string | undefined {
  const text = messages.flatMap(message => message.source.kind === 'user'
    ? message.content.flatMap(block => block.type === 'text' ? [block.text] : [])
    : []).join('\n').trim()
  return text === '' ? undefined : text
}

/** Prepare providers under one timeout and commit only handles selected by the arbiter. */
async function selectAcceptedContributions(input: BrainPreStepInput, query: string): Promise<BrainContribution[]> {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1) {
    throw new RangeError('brain timeoutMs must be a positive safe integer')
  }
  const deadline = new AbortController()
  const timer = setTimeout(() => {
    deadline.abort(new Error('brain provider deadline exceeded'))
  }, input.timeoutMs)
  const signal = AbortSignal.any([input.signal, deadline.signal])
  try {
    const prepared = (await Promise.all(input.providers.map(provider =>
      prepareWithinSignal(provider, input.projectKey, input.sessionId, input.turn, query, signal))))
      .filter((value): value is PreparedProvider => value !== undefined)
    if (signal.aborted) {
      await Promise.all(prepared.map(({ batch }) => cancelQuietly(batch)))
      return []
    }

    const selected = arbitrate(prepared.flatMap(entry => entry.items), {
      maxItems: input.maxItems,
      maxBytes: input.maxBytes,
    })
    const selectedHandles = new Set(selected.map(item => `${item.providerId}\0${item.handle}`))
    const acceptedHandles = new Set<string>()

    await Promise.all(prepared.map(async ({ provider, batch, items }) => {
      const handles = items
        .filter(item => selectedHandles.has(`${provider.id}\0${item.handle}`))
        .map(item => item.handle)
      if (handles.length === 0) {
        await cancelQuietly(batch)
        return
      }
      try {
        await batch.accept(handles)
        for (const handle of handles) acceptedHandles.add(`${provider.id}\0${handle}`)
      } catch {
        await cancelQuietly(batch)
      }
    }))

    return selected.filter(item => acceptedHandles.has(`${item.providerId}\0${item.handle}`))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Apply fail-open pre-step augmentation for the Cordis listener and focused tests.
 * @param input Accepted decision, local providers, project identity, and hard limits.
 * @returns The original decision or one decision augmented with accepted context.
 */
export async function augmentPreStepDecision(input: BrainPreStepInput): Promise<PreStepDecision> {
  if (input.decision.kind === 'reject' || !input.topLevel || input.step !== 1 || input.signal.aborted) {
    return input.decision
  }
  const query = directUserQuery(input.decision.messages)
  if (query === undefined || input.providers.length === 0) return input.decision

  try {
    const selected = await selectAcceptedContributions(input, query)
    if (selected.length === 0) return input.decision
    return {
      kind: 'enter',
      messages: [
        ...input.decision.messages,
        createUserMessage({
          content: [{ type: 'text', text: renderBrainContext(selected) }],
          source: { kind: 'plugin', plugin: 'missher-brain', form: 'recall' },
        }),
      ],
    }
  } catch {
    return input.decision
  }
}
