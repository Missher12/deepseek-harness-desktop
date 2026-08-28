export interface ShortcutRegistrar {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface EmergencyShortcutOptions {
  readonly shortcuts: ShortcutRegistrar
  readonly isLeaseActive: () => boolean
  readonly closeAdmission: () => void
  readonly revokeSynchronously: () => void
  readonly stopAll: () => Promise<void>
}

export class EmergencyShortcutController {
  readonly #options: EmergencyShortcutOptions
  #accelerator: string | null = null
  #generation = 0
  #stopQueue: Promise<void> = Promise.resolve()
  #latestStop: Promise<void> = Promise.resolve()

  constructor(options: EmergencyShortcutOptions) {
    this.#options = options
  }

  activate(accelerator: string): void {
    this.#validateAccelerator(accelerator)
    if (this.#accelerator !== null) throw new Error('emergency shortcut is already active')
    if (!this.#options.isLeaseActive()) {
      throw new Error('emergency shortcut requires an active lease')
    }
    const generation = this.#nextGeneration()
    let registered = false
    try {
      registered = this.#options.shortcuts.register(accelerator, () => {
        this.#handle(generation, accelerator)
      })
    } catch {
      this.#failGrantClosed()
      throw new Error('failed to register the emergency shortcut')
    }
    if (!registered) {
      this.#failGrantClosed()
      throw new Error('failed to register the emergency shortcut')
    }
    this.#generation = generation
    this.#accelerator = accelerator
  }

  rebind(accelerator: string): void {
    this.#validateAccelerator(accelerator)
    const previous = this.#accelerator
    if (previous === null) throw new Error('emergency shortcut is not active')
    if (!this.#options.isLeaseActive()) throw new Error('emergency shortcut requires an active lease')
    if (previous === accelerator) return
    const generation = this.#nextGeneration()
    if (!this.#options.shortcuts.register(accelerator, () => {
      this.#handle(generation, accelerator)
    })) {
      throw new Error('failed to register the replacement emergency shortcut')
    }
    this.#generation = generation
    this.#accelerator = accelerator
    this.#options.shortcuts.unregister(previous)
  }

  deactivate(): void {
    const accelerator = this.#accelerator
    if (accelerator === null) return
    this.#generation = this.#nextGeneration()
    this.#accelerator = null
    this.#options.shortcuts.unregister(accelerator)
  }

  async waitForStop(): Promise<void> {
    await this.#latestStop
  }

  #handle(generation: number, accelerator: string): void {
    if (generation !== this.#generation || accelerator !== this.#accelerator
      || !this.#options.isLeaseActive()) return
    this.#generation = this.#nextGeneration()
    this.#accelerator = null
    try {
      this.#options.closeAdmission()
    } finally {
      try {
        this.#options.revokeSynchronously()
      } finally {
        this.#options.shortcuts.unregister(accelerator)
        this.#enqueueStop()
      }
    }
  }

  #failGrantClosed(): void {
    try {
      this.#options.closeAdmission()
    } finally {
      try {
        this.#options.revokeSynchronously()
      } finally {
        this.#enqueueStop()
      }
    }
  }

  #enqueueStop(): void {
    const pending = this.#stopQueue.then(() => this.#options.stopAll())
    this.#latestStop = pending
    this.#stopQueue = pending.catch(() => {})
  }

  #nextGeneration(): number {
    if (this.#generation === Number.MAX_SAFE_INTEGER) {
      throw new Error('emergency shortcut generation overflow')
    }
    return this.#generation + 1
  }

  #validateAccelerator(accelerator: string): void {
    if (typeof accelerator !== 'string' || accelerator.length === 0
      || accelerator.length > 128 || !/^[\x20-\x7e]+$/.test(accelerator)) {
      throw new TypeError('invalid emergency accelerator')
    }
  }
}
