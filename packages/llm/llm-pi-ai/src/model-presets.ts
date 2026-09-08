/** Local exact-ID presets; endpoint metadata and user edits remain authoritative. */
import type { Api, Model } from '@earendil-works/pi-ai'
import type { LlmDiscoveredModel, LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm'
import { catalogModelConfiguration, catalogModels, catalogProviderIds } from './catalog.ts'

let installed: ReadonlyMap<string, readonly Model<Api>[]> | undefined

/** Build the immutable ID index lazily; a large listing never scans the full catalog per row. */
function index(): ReadonlyMap<string, readonly Model<Api>[]> {
  if (installed !== undefined) return installed
  const byId = new Map<string, Model<Api>[]>()
  for (const provider of catalogProviderIds()) {
    for (const model of catalogModels(provider).values()) {
      const group = byId.get(model.id)
      if (group === undefined) byId.set(model.id, [model])
      else group.push(model)
    }
  }
  installed = byId
  return installed
}

/** Compare a complete configured endpoint without relaxing its origin or path. */
function endpoint(value: string | undefined): string | undefined {
  return value?.replace(/\/+$/u, '')
}

/**
 * Find conservative local defaults for an exact ID and compatible wire protocol.
 * @param request - Draft route, endpoint, protocol and exact model ID; credentials are unused.
 * @returns Editable preset metadata, or undefined when no exact match exists.
 */
export function findModelPreset(request: LlmModelDiscoveryRequest & { modelId: string }): LlmDiscoveredModel | undefined {
  const matches = (index().get(request.modelId) ?? [])
    .filter(model => request.api === undefined || model.api === request.api)
  const route = matches.filter(model => model.provider === request.provider)
  const address = endpoint(request.baseURL)
  const exactEndpoint = address === undefined || address.length === 0
    ? []
    : matches.filter(model => endpoint(model.baseUrl) === address)
  const candidates = exactEndpoint.length > 0 ? exactEndpoint : route.length > 0 ? route : matches
  const first = candidates[0]
  if (first === undefined) return undefined
  const configuration = catalogModelConfiguration(first)
  // Equal IDs can have different provider limits and reasoning wire formats.
  // Take the smallest known capacities; only unanimous protocol defaults travel.
  const sameConfiguration = candidates.every(model => model.api === first.api
    && JSON.stringify(catalogModelConfiguration(model)) === JSON.stringify(configuration))
  return {
    id: request.modelId,
    name: candidates.every(model => model.name === first.name) ? first.name : request.modelId,
    contextWindow: Math.min(...candidates.map(model => model.contextWindow)),
    maxTokens: Math.min(...candidates.map(model => model.maxTokens)),
    inputModalities: first.input.filter(input => candidates.every(model => model.input.includes(input))),
    ...sameConfiguration ? { configuration } : {},
  }
}
