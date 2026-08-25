interface LifecyclePart {
  start(): Promise<void>
  stop(): void | Promise<void>
}

interface RuntimeInbox {
  recover(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
}

interface RuntimeOptions {
  transport: LifecyclePart
  mux: LifecyclePart
  inbox: RuntimeInbox
  cleanup(): Promise<number>
  connectionStatus?(): boolean
}

/** Browser-safe lifecycle and queue-pause status. */
export interface LarkRuntimeStatus {
  enabled: boolean
  connected: boolean
  queuePaused: boolean
}

/** Owns every long-lived resource of one plugin activation generation. */
export class LarkRuntimeController {
  private enabled = false
  private connected = false
  private queuePaused = false
  private disposed = false

  constructor(private readonly options: RuntimeOptions) {}

  /**
   * Restore an enabled runtime during Harness startup.
   * @param enabled - Persisted local enable flag.
   */
  async start(enabled: boolean): Promise<void> {
    if (!enabled) return
    await this.connect()
    await this.options.inbox.recover()
  }

  /** Connect transport and mux under one activation generation. */
  async enable(): Promise<void> {
    if (this.disposed) throw new Error('Lark runtime is disposed')
    if (this.enabled) return
    await this.connect()
  }

  /** Tear down receivers and pause undispatched remote work. */
  async disable(): Promise<void> {
    if (!this.enabled && !this.connected) return
    // Admission reads this flag synchronously before the awaited teardown work.
    this.enabled = false
    this.connected = false
    await this.options.transport.stop()
    await this.options.mux.stop()
    await this.options.inbox.pause()
    this.queuePaused = true
    await this.options.cleanup()
  }

  /** Resume paused remote work only after an explicit local action. */
  async resumeQueue(): Promise<void> {
    if (!this.enabled) throw new Error('Enable the Lark plugin before resuming its queue')
    await this.options.inbox.resume()
    this.queuePaused = false
  }

  /** Permanently dispose this runtime generation. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    await this.disable()
    this.disposed = true
  }

  /**
   * Read the current lifecycle state.
   * @returns Current browser-safe runtime state.
   */
  status(): LarkRuntimeStatus {
    const connected = this.enabled && (this.options.connectionStatus?.() ?? this.connected)
    return { enabled: this.enabled, connected, queuePaused: this.queuePaused }
  }

  /** Reject ingress unless transport and runtime are both active. */
  assertIngress(): void {
    if (!this.status().enabled || !this.status().connected) throw new Error('Lark ingress is disabled')
  }

  private async connect(): Promise<void> {
    await this.options.transport.start()
    try {
      await this.options.mux.start()
    } catch (error) {
      await this.options.transport.stop()
      throw error
    }
    this.enabled = true
    this.connected = true
  }
}
