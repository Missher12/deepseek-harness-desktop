export class FakeMonotonicClock {
  #now = 0
  #nextId = 1
  #timers = new Map<number, { readonly at: number; readonly callback: () => void; cancelled: boolean }>()

  now(): number {
    return this.#now
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.#nextId++
    this.#timers.set(id, { at: this.#now + delayMs, callback, cancelled: false })
    return id
  }

  clearTimeout(id: unknown): void {
    if (typeof id !== 'number') return
    const timer = this.#timers.get(id)
    if (timer) timer.cancelled = true
  }

  advanceTo(value: number): void {
    if (value < this.#now) throw new Error('fake monotonic clock cannot move backwards')
    this.#now = value
    this.flush()
  }

  flush(options: { readonly includeCancelled?: boolean } = {}): void {
    const due = [...this.#timers.entries()]
      .filter(([, timer]) => timer.at <= this.#now && (options.includeCancelled || !timer.cancelled))
      .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])
    for (const [id, timer] of due) {
      this.#timers.delete(id)
      timer.callback()
    }
  }
}
