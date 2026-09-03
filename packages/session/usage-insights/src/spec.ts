/** Rebuildable privacy-minimal usage cache domain declaration. */

import { z } from 'zod'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/**
 * Records stay `unknown` at the storage boundary so a malformed or older cache
 * row cannot prevent the product from starting. The owning service validates
 * each row independently and rebuilds invalid values from session authority.
 */
export const usageInsightsDomainSpec = defineDomain({
  name: 'usage_insights',
  version: 1,
  tables: { sessions: domainTable<SessionId, unknown>(z.unknown()) },
})
