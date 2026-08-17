/** Plugin-owned serialization over the storage-domain's whole-record table. */
import type { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { sessionMessengerDomainSpec } from './spec.ts'
import type { DeliveryId, Receipt } from './types.ts'

/** Minimal repository consumed by the coordinator and its deterministic tests. */
export interface ReceiptRepository {
  get(id: DeliveryId): Receipt | undefined
  entries(): Array<[DeliveryId, Receipt]>
  put(receipt: Receipt): Promise<void>
  delete(id: DeliveryId): Promise<boolean>
  drain(): Promise<void>
}

/** Serialize every single-record mutation inside the plugin boundary. */
export class ReceiptStore implements ReceiptRepository {
  private tail: Promise<void> = Promise.resolve()
  private accepting = true

  constructor(private readonly table: KvTable<DeliveryId, Receipt>) {}

  get(id: DeliveryId): Receipt | undefined {
    return this.table.get(id)
  }

  entries(): Array<[DeliveryId, Receipt]> {
    return [...this.table.entries()]
  }

  put(receipt: Receipt): Promise<void> {
    return this.enqueue(() => this.table.put(receipt.id, receipt))
  }

  delete(id: DeliveryId): Promise<boolean> {
    return this.enqueue(() => this.table.delete(id))
  }

  async drain(): Promise<void> {
    this.accepting = false
    await this.tail
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new Error('session messenger receipt store is closing'))
    const result = this.tail.then(operation)
    this.tail = result.then(() => {}, () => {})
    return result
  }
}

/**
 * Open the plugin's one storage domain; the caller owns the returned close.
 * @param ctx - Cordis context providing the storage-domain service.
 * @returns the serialized receipt store and an asynchronous domain disposer.
 */
export async function openReceiptStore(ctx: Context): Promise<{
  store: ReceiptStore
  close: () => Promise<void>
}> {
  const domain = await ctx.storageDomain.open(sessionMessengerDomainSpec)
  return {
    store: new ReceiptStore(domain.table('receipts')),
    close: () => domain.close(),
  }
}
