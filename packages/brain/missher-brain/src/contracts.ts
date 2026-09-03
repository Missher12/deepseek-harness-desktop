/** A contribution kind understood by the Brain Hub's deterministic arbiter. */
export type BrainContributionKind =
  | 'reviewed-memory'
  | 'memory-capsule'
  | 'legacy-memory'
  | 'learned-rule'

/** One opaque, source-attributed candidate prepared for a single model step. */
export interface BrainContribution {
  handle: string
  providerId: string
  kind: BrainContributionKind
  text: string
  reference: string
  recordedAt: string
  score: number
  pinned: boolean
}

/** Single-use prepared candidates whose source side effects happen only after acceptance. */
export interface PreparedBrainBatch {
  readonly items: readonly BrainContribution[]
  accept(handles: readonly string[]): Promise<void>
  cancel(): Promise<void>
}

/** Pathless provider status safe to expose through the local Desktop UI. */
export interface BrainProviderStatus {
  state: 'ready' | 'disabled' | 'unavailable'
  count: number
}

/** One pathless provider row exposed to the local Desktop settings surface. */
export interface BrainProviderSnapshot extends BrainProviderStatus {
  id: string
  byteBudget: number
}

/** Bounded operational facts for the unified local external brain. */
export interface BrainHubSnapshot {
  generatedAt: number
  limits: {
    maxItems: number
    maxBytes: number
    timeoutMs: number
  }
  providers: BrainProviderSnapshot[]
}

/** Pathless per-turn context required for transactional provider attribution. */
export interface BrainPrepareInput {
  projectKey: string
  sessionId: string
  turn: number
  query: string
  signal: AbortSignal
}

/** Versioned provider contract shared by factual memory and procedural learning. */
export interface BrainProvider {
  readonly protocolVersion: 1
  readonly id: string
  readonly byteBudget: number
  prepare(input: BrainPrepareInput): Promise<PreparedBrainBatch>
  status(): Promise<BrainProviderStatus>
}
