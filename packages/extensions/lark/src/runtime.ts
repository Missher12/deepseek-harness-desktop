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
}

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

  async start(enabled: boolean): Promise<void> {
    if (!enabled) return
    await this.connect()
    await this.options.inbox.recover()
  }

  async enable(): Promise<void> {
    if (this.disposed) throw new Error('Lark runtime is disposed')
    if (this.enabled) return
    await this.connect()
  }

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

  async resumeQueue(): Promise<void> {
    if (!this.enabled) throw new Error('Enable the Lark plugin before resuming its queue')
    await this.options.inbox.resume()
    this.queuePaused = false
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    await this.disable()
    this.disposed = true
  }

  status(): LarkRuntimeStatus {
    return { enabled: this.enabled, connected: this.connected, queuePaused: this.queuePaused }
  }

  assertIngress(): void {
    if (!this.enabled || !this.connected) throw new Error('Lark ingress is disabled')
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
