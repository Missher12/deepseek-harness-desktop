import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  AgentBrowserError,
  BROWSER_AGENT_LIMITS,
  type AgentBrowserRef,
} from '../src/browser/contracts.ts'
import {
  CdpBrowserAdapter,
  type AgentBrowserPinnedNavigationTransport,
} from '../src/browser/cdp-adapter.ts'
import { AgentBrowserUrlPolicy } from '../src/browser/policy.ts'
import { BrowserSurfaceManager, type BrowserSurfaceResource } from '../src/browser/surface-manager.ts'

interface AxNode {
  readonly nodeId: string
  readonly backendDOMNodeId?: number
  readonly childIds?: readonly string[]
  readonly ignored?: boolean
  readonly role?: { readonly value: string }
  readonly name?: { readonly value: string }
  readonly value?: { readonly value: string }
  readonly properties?: readonly { readonly name: string; readonly value?: { readonly value: unknown } }[]
}

type CommandHandler = (params: Readonly<Record<string, unknown>>) => unknown

class FakeDebugger extends EventEmitter {
  attached = false
  attachCalls = 0
  detachCalls = 0
  readonly calls: { readonly method: string; readonly params: Readonly<Record<string, unknown>> }[] = []
  readonly handlers = new Map<string, CommandHandler>()

  isAttached(): boolean { return this.attached }

  attach(): void {
    this.attachCalls += 1
    if (this.attached) throw new Error('already attached')
    this.attached = true
  }

  detach(): void {
    this.detachCalls += 1
    this.attached = false
  }

  sendCommand(method: string, params: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
    this.calls.push({ method, params })
    return Promise.resolve(this.handlers.get(method)?.(params) ?? {})
  }

  emitMessage(method: string, params: Readonly<Record<string, unknown>> = {}): void {
    this.emit('message', {}, method, params)
  }

  emitDetach(): void {
    this.attached = false
    this.emit('detach', {}, 'target closed')
  }
}

class FakeWebContents extends EventEmitter {
  readonly debugger = new FakeDebugger()
  destroyed = false
  loading = false
  url = 'https://example.test/'
  title = 'Example'
  readonly loadedUrls: string[] = []
  historyActiveIndex = 1
  historyEntries: { readonly url: string; readonly title: string; readonly pageState: string }[] = [
    { url: 'https://previous.test/', title: 'Previous', pageState: 'previous-state' },
    { url: 'https://example.test/', title: 'Example', pageState: 'example-state' },
    { url: 'https://next.test/', title: 'Next', pageState: 'next-state' },
  ]
  readonly navigationHistory = {
    canGoBack: () => this.historyActiveIndex > 0,
    canGoForward: () => this.historyActiveIndex + 1 < this.historyEntries.length,
    getActiveIndex: () => this.historyActiveIndex,
    getEntryAtIndex: (index: number) => this.historyEntries[index],
    goBack: vi.fn(() => {
      this.historyActiveIndex -= 1
      this.url = this.historyEntries[this.historyActiveIndex]?.url ?? this.url
    }),
    goForward: vi.fn(() => {
      this.historyActiveIndex += 1
      this.url = this.historyEntries[this.historyActiveIndex]?.url ?? this.url
    }),
    goToIndex: vi.fn((index: number) => {
      this.historyActiveIndex = index
      this.url = this.historyEntries[index]?.url ?? this.url
    }),
  }
  readonly reload = vi.fn()

  isDestroyed(): boolean { return this.destroyed }
  isLoading(): boolean { return this.loading }
  getURL(): string { return this.url }
  getTitle(): string { return this.title }

  async loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url)
    this.url = url
  }

  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

function png(width: number, height: number, bytes = 32): Uint8Array {
  const result = Buffer.alloc(Math.max(24, bytes))
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(result, 0)
  result.writeUInt32BE(13, 8)
  result.write('IHDR', 12, 'ascii')
  result.writeUInt32BE(width, 16)
  result.writeUInt32BE(height, 20)
  return new Uint8Array(result)
}

function installTree(
  contents: FakeWebContents,
  nodes: readonly AxNode[],
  descriptions: Readonly<Record<number, readonly string[]>> = {},
): void {
  let pendingFocusBackendNodeId: number | undefined
  let focusedBackendNodeId: number | undefined
  contents.debugger.handlers.set('Page.setInterceptFileChooserDialog', () => ({}))
  contents.debugger.handlers.set('Accessibility.enable', () => ({}))
  contents.debugger.handlers.set('Accessibility.disable', () => ({}))
  contents.debugger.handlers.set('Accessibility.getRootAXNode', () => ({
    node: { nodeId: 'root', role: { value: 'RootWebArea' }, childIds: ['children'] } satisfies AxNode,
  }))
  contents.debugger.handlers.set('Accessibility.getChildAXNodes', ({ id }) => ({
    nodes: id === 'root' ? nodes.map((node) => {
      const properties = (node.properties ?? []).filter(property => property.name !== 'focused')
      if (node.backendDOMNodeId !== focusedBackendNodeId) return { ...node, properties }
      return { ...node, properties: [...properties, { name: 'focused', value: { value: true } }] }
    }) : [],
  }))
  contents.debugger.handlers.set('DOM.describeNode', ({ backendNodeId }) => ({
    node: { attributes: descriptions[backendNodeId as number] ?? [] },
  }))
  contents.debugger.handlers.set('DOM.getBoxModel', ({ backendNodeId }) => {
    pendingFocusBackendNodeId = backendNodeId as number
    return { model: { content: [0, 0, 100, 0, 100, 40, 0, 40] } }
  })
  contents.debugger.handlers.set('Input.dispatchMouseEvent', ({ type }) => {
    if (type === 'mouseReleased') focusedBackendNodeId = pendingFocusBackendNodeId
    return {}
  })
  for (const method of ['Input.dispatchKeyEvent', 'Input.insertText']) {
    contents.debugger.handlers.set(method, () => ({}))
  }
}

function adapterFor(
  contents: FakeWebContents,
  options: Partial<ConstructorParameters<typeof CdpBrowserAdapter>[0]> = {},
): CdpBrowserAdapter {
  const pinnedNavigationTransport: AgentBrowserPinnedNavigationTransport = {
    load: async (request) => {
      await request.resolveAndValidate(request.url)
      await request.commit()
    },
  }
  return new CdpBrowserAdapter({
    webContents: contents,
    surfaceId: 'surface-1',
    surfaceGeneration: 1,
    viewport: () => ({ width: 1280, height: 720, deviceScaleFactor: 1 }),
    urlPolicy: new AgentBrowserUrlPolicy({ lookup: async () => ['93.184.216.34'] }),
    pinnedNavigationTransport,
    createTransferId: () => '00000000-0000-4000-8000-000000000003',
    ...options,
  })
}

function deferredPinnedTransport(): {
  readonly transport: AgentBrowserPinnedNavigationTransport
  readonly ready: Promise<void>
  readonly resume: () => void
} {
  let markReady: (() => void) | undefined
  let resume: (() => void) | undefined
  const ready = new Promise<void>((resolve) => { markReady = resolve })
  const gate = new Promise<void>((resolve) => { resume = resolve })
  return {
    transport: {
      load: async (request) => {
        await request.resolveAndValidate(request.url)
        markReady?.()
        await gate
        await request.commit()
      },
    },
    ready,
    resume: () => { resume?.() },
  }
}

function mutateHistoryEntry(
  contents: FakeWebContents,
  index: number,
  change: Partial<{ readonly url: string; readonly title: string; readonly pageState: string }>,
): void {
  const entry = contents.historyEntries[index]
  if (entry === undefined) throw new Error('missing fake history entry')
  contents.historyEntries[index] = { ...entry, ...change }
}

function buttonNode(id = 1, name = 'Continue'): AxNode {
  return {
    nodeId: `node-${id}`,
    backendDOMNodeId: id,
    role: { value: 'button' },
    name: { value: name },
  }
}

async function snapshotButton(adapter: CdpBrowserAdapter): Promise<AgentBrowserRef> {
  const snapshot = await adapter.snapshot({ includeImage: false })
  const ref = snapshot.result.refs[0]?.ref
  expect(ref).toMatch(/^browser:[0-9a-f]{32}$/u)
  if (ref === undefined) throw new Error('expected button ref')
  return ref
}

class FakeSurface implements BrowserSurfaceResource {
  readonly log: string[]
  visible = false
  hideCalls = 0
  commitCalls = 0
  releaseCalls = 0

  constructor(
    readonly surfaceId: string,
    readonly partition: string,
    readonly kind: 'ephemeral' | 'human-persistent',
    log: string[] = [],
  ) {
    this.log = log
  }

  installSecurityHandlers(generation: number): { dispose(): void } {
    this.log.push(`guards:${generation}`)
    return { dispose: () => { this.log.push(`dispose-guards:${generation}`) } }
  }

  async mount(mountToken: string): Promise<void> {
    this.log.push(`mount:${mountToken}`)
    this.visible = true
  }

  async commitTransfer(): Promise<void> { this.commitCalls += 1 }
  async releaseTransfer(): Promise<void> { this.releaseCalls += 1 }

  async hide(mountToken: string): Promise<void> {
    this.log.push(`hide:${mountToken}`)
    this.hideCalls += 1
    this.visible = false
  }

  async detachDebugger(): Promise<void> { this.log.push('detach') }
  async teardownView(): Promise<void> { this.log.push('teardown') }
  async clearStorage(): Promise<void> { this.log.push('clear') }
}

describe('semantic Agent browser adapter', () => {
  it('enables the Accessibility domain and retries an initially empty root before snapshotting', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [buttonNode()])
    let roots = 0
    contents.debugger.handlers.set('Accessibility.getRootAXNode', () => {
      roots += 1
      return roots < 3
        ? {}
        : { node: { nodeId: 'root', role: { value: 'RootWebArea' }, childIds: ['children'] } }
    })
    const retry = vi.fn(async () => {})

    const result = await adapterFor(contents, { delay: retry }).snapshot({ includeImage: false })

    expect(result.result.refs).toHaveLength(1)
    expect(roots).toBe(3)
    expect(retry).toHaveBeenCalledTimes(2)
    expect(contents.debugger.calls.findIndex(call => call.method === 'Accessibility.enable'))
      .toBeLessThan(contents.debugger.calls.findIndex(call => call.method === 'Accessibility.getRootAXNode'))
  })

  it('retries the renderer-sensitive debugger handshake exactly once without reattaching', async () => {
    vi.useFakeTimers()
    try {
      const contents = new FakeWebContents()
      let attempts = 0
      contents.debugger.handlers.set('Page.setInterceptFileChooserDialog', () => {
        attempts += 1
        if (attempts === 1) return new Promise(() => {})
        return {}
      })
      const starting = adapterFor(contents).start()

      await vi.advanceTimersByTimeAsync(BROWSER_AGENT_LIMITS.startupMs / BROWSER_AGENT_LIMITS.startupAttempts)
      await starting

      expect(attempts).toBe(BROWSER_AGENT_LIMITS.startupAttempts)
      expect(contents.debugger.attachCalls).toBe(1)
      expect(contents.debugger.detachCalls).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns BUSY for a foreign debugger and never detaches it', async () => {
    const contents = new FakeWebContents()
    contents.debugger.attached = true
    const adapter = adapterFor(contents)

    await expect(adapter.start()).rejects.toMatchObject({ code: 'BUSY' })
    await adapter.stop()
    expect(contents.debugger.attachCalls).toBe(0)
    expect(contents.debugger.detachCalls).toBe(0)
  })

  it('treats a debugger that wins the attach race as foreign and never detaches it', async () => {
    const contents = new FakeWebContents()
    contents.debugger.attach = () => {
      contents.debugger.attachCalls += 1
      contents.debugger.attached = true
      throw new Error('another debugger attached first')
    }
    const adapter = adapterFor(contents)

    await expect(adapter.start()).rejects.toMatchObject({ code: 'BUSY' })
    await adapter.stop()
    expect(contents.debugger.detachCalls).toBe(0)
  })

  it('detaches exactly once only after its own successful attach', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    const adapter = adapterFor(contents)

    await adapter.start()
    await adapter.stop()
    await adapter.stop()
    expect(contents.debugger.attachCalls).toBe(1)
    expect(contents.debugger.detachCalls).toBe(1)
    expect(contents.debugger.calls.filter(call => call.method === 'Page.setInterceptFileChooserDialog'))
      .toEqual([
        { method: 'Page.setInterceptFileChooserDialog', params: { enabled: true } },
        { method: 'Page.setInterceptFileChooserDialog', params: { enabled: false } },
      ])
    expect(contents.debugger.calls.filter(call => call.method.startsWith('Accessibility.')))
      .toEqual([
        { method: 'Accessibility.enable', params: {} },
        { method: 'Accessibility.disable', params: {} },
      ])
  })

  it('keeps owned debugger cleanup retryable when detach has not reached quiescence', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    let detachAttempts = 0
    contents.debugger.detach = () => {
      contents.debugger.detachCalls += 1
      detachAttempts += 1
      if (detachAttempts === 1) throw new Error('detach failed')
      contents.debugger.attached = false
    }
    const adapter = adapterFor(contents)
    await adapter.start()

    await expect(adapter.stop()).rejects.toMatchObject({ code: 'INTERNAL' })
    expect(contents.debugger.attached).toBe(true)
    await expect(adapter.stop()).resolves.toBeUndefined()
    expect(contents.debugger.detachCalls).toBe(2)
    expect(contents.debugger.attached).toBe(false)
  })

  it('does not issue stale chooser or detach cleanup after debugger ownership is externally lost', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    const adapter = adapterFor(contents)
    await adapter.start()
    contents.debugger.calls.length = 0

    contents.debugger.emitDetach()
    await adapter.stop()

    expect(contents.debugger.calls).toEqual([])
    expect(contents.debugger.detachCalls).toBe(0)
  })

  it.each([
    ['main-document navigation', (contents: FakeWebContents) => { contents.emit('did-navigate') }, 'STALE_REF'],
    ['same-document navigation', (contents: FakeWebContents) => { contents.emit('did-navigate-in-page') }, 'STALE_REF'],
    ['material tree change', (contents: FakeWebContents) => {
      contents.debugger.emitMessage('Accessibility.nodesUpdated')
    }, 'STALE_REF'],
    ['DOM material tree change', (contents: FakeWebContents) => {
      contents.debugger.emitMessage('DOM.documentUpdated')
    }, 'STALE_REF'],
    ['debugger detach', (contents: FakeWebContents) => { contents.debugger.emitDetach() }, 'STALE_REF'],
    ['surface destruction', (contents: FakeWebContents) => { contents.destroy() }, 'TARGET_CLOSED'],
  ])('invalidates refs on %s', async (_label, invalidate, code) => {
    const contents = new FakeWebContents()
    installTree(contents, [buttonNode()])
    const adapter = adapterFor(contents)
    const ref = await snapshotButton(adapter)

    invalidate(contents)
    await expect(adapter.act({ kind: 'click', ref })).rejects.toMatchObject({ code })
  })

  it('discards a late CDP response after navigation invalidates its generation', async () => {
    const contents = new FakeWebContents()
    contents.debugger.handlers.set('Page.setInterceptFileChooserDialog', () => ({}))
    let resolveRoot: ((value: unknown) => void) | undefined
    contents.debugger.handlers.set('Accessibility.getRootAXNode', () => new Promise((resolve) => {
      resolveRoot = resolve
    }))
    const adapter = adapterFor(contents)
    const pending = adapter.snapshot({ includeImage: false })
    await vi.waitFor(() => {
      expect(contents.debugger.calls.some(call => call.method === 'Accessibility.getRootAXNode')).toBe(true)
    })

    contents.emit('did-navigate-in-page')
    resolveRoot?.({ node: { nodeId: 'root', role: { value: 'RootWebArea' } } })
    await expect(pending).rejects.toMatchObject({ code: 'STALE_REF' })
  })

  it('times out a hung CDP response at the wall bound and cancels one without waiting for it', async () => {
    vi.useFakeTimers()
    try {
      const timedOutContents = new FakeWebContents()
      timedOutContents.debugger.handlers.set('Page.setInterceptFileChooserDialog', () => ({}))
      timedOutContents.debugger.handlers.set('Accessibility.getRootAXNode', () => new Promise(() => {}))
      const timedOut = adapterFor(timedOutContents).snapshot({ includeImage: false })
      const timeoutAssertion = expect(timedOut).rejects.toMatchObject({ code: 'TIMEOUT' })
      await vi.advanceTimersByTimeAsync(BROWSER_AGENT_LIMITS.wallMs + 1)
      await timeoutAssertion

      const cancelledContents = new FakeWebContents()
      cancelledContents.debugger.handlers.set('Page.setInterceptFileChooserDialog', () => ({}))
      cancelledContents.debugger.handlers.set('Accessibility.getRootAXNode', () => new Promise(() => {}))
      const controller = new AbortController()
      const cancelled = adapterFor(cancelledContents).snapshot({ includeImage: false }, controller.signal)
      const cancellationAssertion = expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' })
      await vi.advanceTimersByTimeAsync(0)
      controller.abort()
      await cancellationAssertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds raw nodes, depth, CDP calls, wall time, output refs, semantic UTF-8, and JSON bytes', async () => {
    const rawContents = new FakeWebContents()
    installTree(rawContents, Array.from({ length: BROWSER_AGENT_LIMITS.rawNodes }, (_, index) => buttonNode(index + 1)))
    await expect(adapterFor(rawContents).snapshot({ includeImage: false }))
      .rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })

    const callContents = new FakeWebContents()
    const branchNodes = Array.from({ length: BROWSER_AGENT_LIMITS.cdpCalls }, (_, index) => ({
      ...buttonNode(index + 1), childIds: [`leaf-${index}`],
    }))
    installTree(callContents, branchNodes)
    await expect(adapterFor(callContents).snapshot({ includeImage: false }))
      .rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })
    expect(callContents.debugger.calls.filter(call => call.method !== 'Page.setInterceptFileChooserDialog'
      && call.method !== 'Accessibility.enable').length)
      .toBeLessThanOrEqual(BROWSER_AGENT_LIMITS.cdpCalls)

    const wallContents = new FakeWebContents()
    installTree(wallContents, [])
    let now = 0
    wallContents.debugger.handlers.set('Accessibility.getRootAXNode', () => {
      now = BROWSER_AGENT_LIMITS.wallMs + 1
      return { node: { nodeId: 'root', role: { value: 'RootWebArea' } } }
    })
    await expect(adapterFor(wallContents, { now: () => now })
      .snapshot({ includeImage: false })).rejects.toMatchObject({ code: 'TIMEOUT' })

    const boundedContents = new FakeWebContents()
    const longName = '界'.repeat(1_024)
    installTree(boundedContents, Array.from({ length: 400 }, (_, index) => buttonNode(index + 1, longName)))
    const bounded = await adapterFor(boundedContents).snapshot({ includeImage: false })
    expect(bounded.result.refs.length).toBeLessThanOrEqual(BROWSER_AGENT_LIMITS.actionableNodes)
    expect(new TextEncoder().encode(bounded.result.semanticText).byteLength)
      .toBeLessThanOrEqual(BROWSER_AGENT_LIMITS.semanticUtf8Bytes)
    expect(new TextEncoder().encode(JSON.stringify(bounded.result)).byteLength)
      .toBeLessThanOrEqual(BROWSER_AGENT_LIMITS.encodedJsonBytes)

    const depthContents = new FakeWebContents()
    const visited: string[] = []
    depthContents.debugger.handlers.set('Page.setInterceptFileChooserDialog', () => ({}))
    depthContents.debugger.handlers.set('Accessibility.getRootAXNode', () => ({
      node: { nodeId: 'depth-0', role: { value: 'RootWebArea' }, childIds: ['depth-1'] },
    }))
    depthContents.debugger.handlers.set('Accessibility.getChildAXNodes', ({ id }) => {
      const current = Number((id as string).split('-')[1])
      visited.push(id as string)
      const next = current + 1
      return { nodes: [{
        nodeId: `depth-${next}`,
        role: { value: 'generic' },
        childIds: [`depth-${next + 1}`],
      }] }
    })
    await adapterFor(depthContents).snapshot({ includeImage: false })
    expect(visited).toHaveLength(BROWSER_AGENT_LIMITS.depth)
    expect(visited).not.toContain(`depth-${BROWSER_AGENT_LIMITS.depth}`)
  })

  it('uses only the closed CDP roster, omits editable values, and denies sensitive/file targets', async () => {
    const contents = new FakeWebContents()
    const nodes: AxNode[] = [
      buttonNode(1, 'Continue'),
      { nodeId: 'safe', backendDOMNodeId: 2, role: { value: 'textbox' }, name: { value: 'Search' }, value: { value: 'SECRET-VALUE' } },
      { nodeId: 'password', backendDOMNodeId: 3, role: { value: 'textbox' }, name: { value: 'Password' } },
      { nodeId: 'file', backendDOMNodeId: 4, role: { value: 'textbox' }, name: { value: 'File' } },
      { nodeId: 'otp', backendDOMNodeId: 5, role: { value: 'textbox' }, name: { value: 'Verification code' } },
      { nodeId: 'unknown', backendDOMNodeId: 6, role: { value: 'textbox' }, name: { value: 'Unknown' } },
      buttonNode(7, 'Upload file'),
      { nodeId: 'country', backendDOMNodeId: 8, role: { value: 'combobox' }, name: { value: 'Country' } },
      buttonNode(9, 'Choose'),
      buttonNode(10, 'Inactive'),
    ]
    installTree(contents, nodes, {
      2: ['type', 'text', 'autocomplete', 'off'],
      3: ['type', 'password'],
      4: ['type', 'file'],
      5: ['type', 'text', 'autocomplete', 'one-time-code'],
      6: [],
      8: ['type', 'text', 'autocomplete', 'off'],
      9: ['type', 'file'],
      10: ['disabled', ''],
    })
    const adapter = adapterFor(contents, { delay: async () => {} })
    const snapshot = await adapter.snapshot({ includeImage: false })
    expect(snapshot.result.refs.map(ref => ref.name)).toEqual(['Continue', 'Search', 'Country'])
    expect(snapshot.result.semanticText).not.toContain('SECRET-VALUE')
    expect(snapshot.result.semanticText).not.toMatch(/Password|Verification code|Upload file|Unknown/u)

    const refs = new Map(snapshot.result.refs.map(ref => [ref.name, ref.ref]))
    const continueRef = refs.get('Continue')
    const searchRef = refs.get('Search')
    const countryRef = refs.get('Country')
    if (continueRef === undefined || searchRef === undefined || countryRef === undefined) {
      throw new Error('expected actionable refs')
    }
    await adapter.act({ kind: 'click', ref: continueRef })
    await adapter.act({ kind: 'type', ref: searchRef, text: 'query' })
    await adapter.act({ kind: 'select', ref: countryRef, value: 'Canada' })
    await adapter.act({ kind: 'key', key: 'Enter', modifiers: [] })
    await adapter.act({ kind: 'scroll', ref: continueRef, deltaX: 0, deltaY: 120 })
    await adapter.act({ kind: 'scroll', deltaX: 0, deltaY: 120 })
    await adapter.act({ kind: 'wait', mode: 'duration', durationMs: 1 })

    const allowed = new Set([
      'Accessibility.enable',
      'Accessibility.getRootAXNode',
      'Accessibility.getChildAXNodes',
      'DOM.describeNode',
      'DOM.getBoxModel',
      'Input.dispatchMouseEvent',
      'Input.dispatchKeyEvent',
      'Input.insertText',
      'Page.captureScreenshot',
      'Page.setInterceptFileChooserDialog',
    ])
    expect(contents.debugger.calls.every(call => allowed.has(call.method))).toBe(true)
    expect(contents.debugger.calls.some(call => call.method.startsWith('Runtime.'))).toBe(false)
    expect(contents.debugger.calls.some(call => /evaluate|selector|setFileInputFiles/iu.test(call.method))).toBe(false)
    expect(contents.debugger.calls).toContainEqual({
      method: 'Page.setInterceptFileChooserDialog', params: { enabled: true },
    })
    expect((adapter as unknown as { sendCommand?: unknown }).sendCommand).toBeUndefined()
  })

  it.each([
    ['click', buttonNode(1, 'Continue'), [] as string[], ['type', 'file'],
      (ref: AgentBrowserRef) => ({ kind: 'click', ref }) as const],
    ['type', {
      nodeId: 'field', backendDOMNodeId: 1, role: { value: 'textbox' }, name: { value: 'Search' },
    } satisfies AxNode, ['type', 'text', 'autocomplete', 'off'], ['type', 'password'],
    (ref: AgentBrowserRef) => ({ kind: 'type', ref, text: 'secret' }) as const],
    ['select', {
      nodeId: 'select', backendDOMNodeId: 1, role: { value: 'combobox' }, name: { value: 'Country' },
    } satisfies AxNode, ['type', 'text', 'autocomplete', 'off'], ['disabled', ''],
    (ref: AgentBrowserRef) => ({ kind: 'select', ref, value: 'Canada' }) as const],
    ['ref scroll', buttonNode(1, 'Continue'), [] as string[], ['readonly', ''],
      (ref: AgentBrowserRef) => ({ kind: 'scroll', ref, deltaX: 0, deltaY: 100 }) as const],
  ])('revalidates a ref immediately before %s and rejects a newly sensitive target', async (
    _label,
    node,
    initialAttributes,
    mutatedAttributes,
    action,
  ) => {
    const contents = new FakeWebContents()
    const descriptions: Record<number, readonly string[]> = { 1: initialAttributes }
    installTree(contents, [node], descriptions)
    const adapter = adapterFor(contents)
    const ref = await snapshotButton(adapter)
    descriptions[1] = mutatedAttributes
    contents.debugger.calls.length = 0

    await expect(adapter.act(action(ref))).rejects.toMatchObject({ code: 'POLICY_DENIED' })
    expect(contents.debugger.calls).toEqual([
      { method: 'Accessibility.getRootAXNode', params: {} },
      { method: 'Accessibility.getChildAXNodes', params: { id: 'root' } },
      { method: 'DOM.describeNode', params: { backendNodeId: 1, depth: 0, pierce: false } },
    ])
  })

  it.each([
    ['type', {
      nodeId: 'field', backendDOMNodeId: 1, role: { value: 'textbox' }, name: { value: 'Search' },
    } satisfies AxNode, ['type', 'text', 'autocomplete', 'off'],
    (ref: AgentBrowserRef) => ({ kind: 'type', ref, text: 'secret' }) as const],
    ['select', {
      nodeId: 'select', backendDOMNodeId: 1, role: { value: 'combobox' }, name: { value: 'Country' },
    } satisfies AxNode, ['type', 'text', 'autocomplete', 'off'],
    (ref: AgentBrowserRef) => ({ kind: 'select', ref, value: 'Canada' }) as const],
  ])('rejects %s when click retargets focus before any text or Enter dispatch', async (
    _label,
    safeNode,
    safeAttributes,
    action,
  ) => {
    const contents = new FakeWebContents()
    let currentNodes: readonly AxNode[] = [safeNode]
    installTree(contents, [], {
      1: safeAttributes,
      2: ['type', 'password', 'autocomplete', 'one-time-code'],
    })
    contents.debugger.handlers.set('Accessibility.getChildAXNodes', ({ id }) => ({
      nodes: id === 'root' ? currentNodes : [],
    }))
    contents.debugger.handlers.set('Input.dispatchMouseEvent', ({ type }) => {
      if (type === 'mouseReleased') {
        currentNodes = [
          safeNode,
          {
            nodeId: 'retargeted-password',
            backendDOMNodeId: 2,
            role: { value: 'textbox' },
            name: { value: 'Verification code' },
            properties: [{ name: 'focused', value: { value: true } }],
          },
        ]
      }
      return {}
    })
    const adapter = adapterFor(contents)
    const ref = await snapshotButton(adapter)
    contents.debugger.calls.length = 0

    await expect(adapter.act(action(ref))).rejects.toMatchObject({ code: 'STALE_REF' })
    expect(contents.debugger.calls.some(call => call.method === 'Input.insertText')).toBe(false)
    expect(contents.debugger.calls.some(call => call.method === 'Input.dispatchKeyEvent')).toBe(false)
  })

  it('rejects a ref whose live AX role or accessible name changed after snapshot', async () => {
    const contents = new FakeWebContents()
    let current: AxNode = buttonNode(1, 'Continue')
    installTree(contents, [])
    contents.debugger.handlers.set('Accessibility.getChildAXNodes', ({ id }) => ({
      nodes: id === 'root' ? [current] : [],
    }))
    const adapter = adapterFor(contents)
    const ref = await snapshotButton(adapter)
    current = {
      nodeId: 'changed',
      backendDOMNodeId: 1,
      role: { value: 'textbox' },
      name: { value: 'Verification code' },
    }
    contents.debugger.calls.length = 0

    await expect(adapter.act({ kind: 'click', ref })).rejects.toMatchObject({ code: 'POLICY_DENIED' })
    expect(contents.debugger.calls.some(call => call.method.startsWith('Input.'))).toBe(false)
  })

  it('invalidates refs across a navigation race before dispatching input', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [buttonNode()])
    let resolveBox: ((value: unknown) => void) | undefined
    contents.debugger.handlers.set('DOM.getBoxModel', () => new Promise((resolve) => { resolveBox = resolve }))
    const adapter = adapterFor(contents)
    const ref = await snapshotButton(adapter)
    const pending = adapter.act({ kind: 'click', ref })
    await vi.waitFor(() => {
      expect(contents.debugger.calls.some(call => call.method === 'DOM.getBoxModel')).toBe(true)
    })
    contents.emit('did-navigate')
    resolveBox?.({ model: { content: [0, 0, 100, 0, 100, 40, 0, 40] } })

    await expect(pending).rejects.toMatchObject({ code: 'STALE_REF' })
    expect(contents.debugger.calls.some(call => call.method === 'Input.dispatchMouseEvent')).toBe(false)
  })

  it('cancels page-directed navigation and independently authorizes every redirect hop', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    const authorize = vi.fn(async (value: string) => {
      if (value.includes('127.0.0.1')) throw new AgentBrowserError('POLICY_DENIED', 'private destination')
      return new URL(value).href
    })
    const resolveForConnect = vi.fn(async (value: string) => ({
      url: new URL(value).href,
      hostname: new URL(value).hostname,
      addresses: ['93.184.216.34'],
    }))
    const adapter = adapterFor(contents, { urlPolicy: { authorize, resolveForConnect } })
    await adapter.start()

    const denied = { preventDefault: vi.fn() }
    contents.emit('will-redirect', denied, 'http://127.0.0.1/private')
    await vi.waitFor(() => { expect(authorize).toHaveBeenCalledWith('http://127.0.0.1/private') })
    expect(denied.preventDefault).toHaveBeenCalledOnce()
    expect(contents.loadedUrls).toEqual([])

    const allowed = { preventDefault: vi.fn() }
    contents.emit('will-redirect', allowed, 'https://public.test/next')
    await vi.waitFor(() => { expect(contents.loadedUrls).toEqual(['https://public.test/next']) })
    expect(allowed.preventDefault).toHaveBeenCalledOnce()
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(resolveForConnect).toHaveBeenCalledOnce()
  })

  it('fails closed before load or connect when Chromium DNS rebinds from public to private', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    const answers: string[][] = [['93.184.216.34'], ['127.0.0.1']]
    const lookup = vi.fn(async (): Promise<readonly string[]> => answers.shift() ?? ['127.0.0.1'])
    const connect = vi.fn(async (_address: string) => { await contents.loadURL('https://rebind.test/') })
    const pinnedNavigationTransport: AgentBrowserPinnedNavigationTransport = {
      load: async (request) => {
        const binding = await request.resolveAndValidate(request.url)
        await connect(binding.addresses[0] ?? '')
      },
    }
    const adapter = adapterFor(contents, {
      urlPolicy: new AgentBrowserUrlPolicy({ lookup }),
      pinnedNavigationTransport,
    })

    await expect(adapter.act({ kind: 'navigate', url: 'https://rebind.test/' }))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' })
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(connect).not.toHaveBeenCalled()
    expect(contents.loadedUrls).toEqual([])
  })

  it('never falls back to loadURL for a hostname without a pinned navigation transport', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    const adapter = new CdpBrowserAdapter({
      webContents: contents,
      surfaceId: 'surface-1',
      surfaceGeneration: 1,
      viewport: () => ({ width: 1280, height: 720, deviceScaleFactor: 1 }),
      urlPolicy: new AgentBrowserUrlPolicy({ lookup: async () => ['93.184.216.34'] }),
    })

    await expect(adapter.act({ kind: 'navigate', url: 'https://public.test/' }))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' })
    expect(contents.loadedUrls).toEqual([])
  })

  it.each(['back', 'forward', 'reload'] as const)(
    'never invokes native hostname %s without a pinned navigation transport',
    async (kind) => {
      const contents = new FakeWebContents()
      installTree(contents, [])
      const adapter = new CdpBrowserAdapter({
        webContents: contents,
        surfaceId: 'surface-1',
        surfaceGeneration: 1,
        viewport: () => ({ width: 1280, height: 720, deviceScaleFactor: 1 }),
        urlPolicy: new AgentBrowserUrlPolicy({ lookup: async () => ['93.184.216.34'] }),
      })

      await expect(adapter.act({ kind })).rejects.toMatchObject({ code: 'POLICY_DENIED' })
      expect(contents.navigationHistory.goBack).not.toHaveBeenCalled()
      expect(contents.navigationHistory.goForward).not.toHaveBeenCalled()
      expect(contents.navigationHistory.goToIndex).not.toHaveBeenCalled()
      expect(contents.reload).not.toHaveBeenCalled()
      expect(contents.loadedUrls).toEqual([])
    },
  )

  it.each(['back', 'forward', 'reload'] as const)(
    'fails closed before native hostname %s when request-time DNS becomes private',
    async (kind) => {
      const contents = new FakeWebContents()
      installTree(contents, [])
      const answers: string[][] = [['93.184.216.34'], ['127.0.0.1']]
      const lookup = vi.fn(async (): Promise<readonly string[]> => answers.shift() ?? ['127.0.0.1'])
      const connect = vi.fn()
      const pinnedNavigationTransport: AgentBrowserPinnedNavigationTransport = {
        load: async (request) => {
          const binding = await request.resolveAndValidate(request.url)
          await connect(binding.addresses[0] ?? '')
        },
      }
      const adapter = adapterFor(contents, {
        urlPolicy: new AgentBrowserUrlPolicy({ lookup }),
        pinnedNavigationTransport,
      })

      await expect(adapter.act({ kind })).rejects.toMatchObject({ code: 'POLICY_DENIED' })
      expect(lookup).toHaveBeenCalledTimes(2)
      expect(connect).not.toHaveBeenCalled()
      expect(contents.navigationHistory.goBack).not.toHaveBeenCalled()
      expect(contents.navigationHistory.goForward).not.toHaveBeenCalled()
      expect(contents.navigationHistory.goToIndex).not.toHaveBeenCalled()
      expect(contents.reload).not.toHaveBeenCalled()
      expect(contents.loadedUrls).toEqual([])
    },
  )

  it.each([
    ['adapter revision', (contents: FakeWebContents) => { contents.emit('did-navigate') }],
    ['current URL', (contents: FakeWebContents) => { contents.url = 'https://changed.test/' }],
    ['active index', (contents: FakeWebContents) => { contents.historyActiveIndex = 0 }],
    ['active entry URL', (contents: FakeWebContents) => {
      mutateHistoryEntry(contents, 1, { url: 'https://changed.test/' })
    }],
    ['active entry title', (contents: FakeWebContents) => {
      mutateHistoryEntry(contents, 1, { title: 'Changed' })
    }],
    ['active entry page state', (contents: FakeWebContents) => {
      mutateHistoryEntry(contents, 1, { pageState: 'changed-state' })
    }],
    ['target entry URL', (contents: FakeWebContents) => {
      mutateHistoryEntry(contents, 2, { url: 'https://changed.test/' })
    }],
    ['target entry title', (contents: FakeWebContents) => {
      mutateHistoryEntry(contents, 2, { title: 'Changed' })
    }],
    ['target entry page state', (contents: FakeWebContents) => {
      mutateHistoryEntry(contents, 2, { pageState: 'changed-state' })
    }],
  ] as const)('rejects history %s drift while the pinned transport is pending', async (_label, mutate) => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    const deferred = deferredPinnedTransport()
    const adapter = adapterFor(contents, { pinnedNavigationTransport: deferred.transport })

    const pending = adapter.act({ kind: 'forward' })
    await deferred.ready
    mutate(contents)
    deferred.resume()

    await expect(pending).rejects.toMatchObject({ code: 'STALE_REF' })
    expect(contents.navigationHistory.goBack).not.toHaveBeenCalled()
    expect(contents.navigationHistory.goForward).not.toHaveBeenCalled()
    expect(contents.navigationHistory.goToIndex).not.toHaveBeenCalled()
    expect(contents.reload).not.toHaveBeenCalled()
    expect(contents.loadedUrls).toEqual([])
  })

  it.each([
    ['current URL', (contents: FakeWebContents) => { contents.url = 'https://changed.test/' }],
    ['navigation revision', (contents: FakeWebContents) => { contents.emit('did-navigate') }],
  ] as const)('rejects reload when %s changes while the pinned transport is pending', async (_label, mutate) => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    const deferred = deferredPinnedTransport()
    const adapter = adapterFor(contents, { pinnedNavigationTransport: deferred.transport })

    const pending = adapter.act({ kind: 'reload' })
    await deferred.ready
    mutate(contents)
    deferred.resume()

    await expect(pending).rejects.toMatchObject({ code: 'STALE_REF' })
    expect(contents.navigationHistory.goToIndex).not.toHaveBeenCalled()
    expect(contents.reload).not.toHaveBeenCalled()
    expect(contents.loadedUrls).toEqual([])
  })

  it('rejects a late native commit after the pinned transport has failed', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    let lateCommit: (() => Promise<void>) | undefined
    const pinnedNavigationTransport: AgentBrowserPinnedNavigationTransport = {
      load: async (request) => {
        await request.resolveAndValidate(request.url)
        lateCommit = request.commit
        throw new Error('transport failed')
      },
    }
    const adapter = adapterFor(contents, { pinnedNavigationTransport })

    await expect(adapter.act({ kind: 'reload' })).rejects.toMatchObject({ code: 'INTERNAL' })
    await expect(lateCommit?.()).rejects.toMatchObject({ code: 'POLICY_DENIED' })
    expect(contents.reload).not.toHaveBeenCalled()
  })

  it('loads an authorized public IP literal without hostname transport or URL rewriting', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    const adapter = new CdpBrowserAdapter({
      webContents: contents,
      surfaceId: 'surface-1',
      surfaceGeneration: 1,
      viewport: () => ({ width: 1280, height: 720, deviceScaleFactor: 1 }),
      urlPolicy: new AgentBrowserUrlPolicy({ lookup: async () => { throw new Error('literal IP must not resolve') } }),
    })

    await expect(adapter.act({ kind: 'navigate', url: 'https://93.184.216.34/' }))
      .resolves.toMatchObject({ url: 'https://93.184.216.34/' })
    expect(contents.loadedUrls).toEqual(['https://93.184.216.34/'])
  })

  it('rejects plain HTTP even for a public IP literal before Chromium can connect', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    const adapter = new CdpBrowserAdapter({
      webContents: contents,
      surfaceId: 'surface-1',
      surfaceGeneration: 1,
      viewport: () => ({ width: 1280, height: 720, deviceScaleFactor: 1 }),
      urlPolicy: new AgentBrowserUrlPolicy({ lookup: async () => ['93.184.216.34'] }),
    })

    await expect(adapter.act({ kind: 'navigate', url: 'http://93.184.216.34/' }))
      .rejects.toMatchObject({ code: 'POLICY_DENIED' })
    expect(contents.loadedUrls).toEqual([])
  })

  it('does not retain a navigation approval after loadURL fails', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    contents.loadURL = async (url) => { contents.loadedUrls.push(url); throw new Error('navigation failed') }
    const authorize = vi.fn(async (value: string) => new URL(value).href)
    const resolveForConnect = vi.fn(async (value: string) => ({
      url: new URL(value).href,
      hostname: new URL(value).hostname,
      addresses: ['93.184.216.34'],
    }))
    const adapter = adapterFor(contents, { urlPolicy: { authorize, resolveForConnect } })
    await adapter.start()

    await expect(adapter.act({ kind: 'navigate', url: 'https://public.test/next' }))
      .rejects.toMatchObject({ code: 'INTERNAL' })
    const pageNavigation = { preventDefault: vi.fn() }
    contents.emit('will-navigate', pageNavigation, 'https://public.test/next')
    await vi.waitFor(() => { expect(authorize).toHaveBeenCalledTimes(2) })
    expect(pageNavigation.preventDefault).toHaveBeenCalledOnce()
  })

  it('treats navigation wait as a current-load barrier and closes the loading-idle subscribe race', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    const adapter = adapterFor(contents)
    await adapter.start()

    await expect(adapter.act({ kind: 'wait', mode: 'navigation' }))
      .resolves.toMatchObject({ waited: true })

    contents.loading = true
    const idle = adapter.act({ kind: 'wait', mode: 'loading-idle' })
    await vi.waitFor(() => { expect(contents.listenerCount('did-stop-loading')).toBe(1) })
    contents.loading = false
    contents.emit('did-stop-loading')
    await expect(idle).resolves.toMatchObject({ waited: true })

    let stopListenersDuringCheck = 0
    contents.isLoading = () => {
      stopListenersDuringCheck = contents.listenerCount('did-stop-loading')
      return false
    }
    await expect(adapter.act({ kind: 'wait', mode: 'loading-idle' }))
      .resolves.toMatchObject({ waited: true })
    expect(stopListenersDuringCheck).toBe(1)
  })

  it('treats the initial about:blank back entry as a safe no-op instead of a protected target', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    contents.historyEntries = [
      { url: 'about:blank', title: '', pageState: 'initial' },
      { url: 'https://example.test/', title: 'Example', pageState: 'example-state' },
    ]
    contents.historyActiveIndex = 1
    contents.url = 'https://example.test/'

    await expect(adapterFor(contents).act({ kind: 'back' }))
      .resolves.toMatchObject({ url: 'https://example.test/' })
    expect(contents.navigationHistory.goToIndex).not.toHaveBeenCalled()
    expect(contents.loadedUrls).toEqual([])
  })

  it('pre-scales a high-DPI oversized viewport and validates PNG dimensions and SHA-256', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    const image = png(2_048, 1_536)
    contents.debugger.handlers.set('Page.captureScreenshot', () => ({ data: Buffer.from(image).toString('base64') }))
    const adapter = adapterFor(contents, {
      viewport: () => ({ width: 4_000, height: 3_000, deviceScaleFactor: 2 }),
    })

    const snapshot = await adapter.snapshot({ includeImage: true })
    const capture = contents.debugger.calls.find(call => call.method === 'Page.captureScreenshot')
    expect(capture?.params).toMatchObject({
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: 4_000, height: 3_000, scale: 0.256 },
    })
    expect(snapshot.result.image).toEqual({
      transferId: '00000000-0000-4000-8000-000000000003',
      byteLength: image.byteLength,
      sha256: createHash('sha256').update(image).digest('hex'),
      width: 2_048,
      height: 1_536,
    })
    expect(snapshot.png).toEqual(image)
    expect(snapshot.png).not.toBe(image)
  })

  it('geometrically retries an oversized PNG at most three times and otherwise fails closed', async () => {
    const contents = new FakeWebContents()
    installTree(contents, [])
    const oversized = png(100, 100, BROWSER_AGENT_LIMITS.pngBytes + 1)
    const valid = png(25, 25)
    let attempt = 0
    contents.debugger.handlers.set('Page.captureScreenshot', () => ({
      data: Buffer.from(attempt++ < 2 ? oversized : valid).toString('base64'),
    }))
    const adapter = adapterFor(contents, { viewport: () => ({ width: 100, height: 100, deviceScaleFactor: 1 }) })
    const snapshot = await adapter.snapshot({ includeImage: true })
    expect(contents.debugger.calls.filter(call => call.method === 'Page.captureScreenshot')
      .map(call => (call.params.clip as { scale: number }).scale)).toEqual([1, 0.5, 0.25])
    expect(snapshot.result.image?.width).toBe(25)

    const failingContents = new FakeWebContents()
    installTree(failingContents, [])
    failingContents.debugger.handlers.set('Page.captureScreenshot', () => ({
      data: Buffer.from(oversized).toString('base64'),
    }))
    await expect(adapterFor(failingContents).snapshot({ includeImage: true }))
      .rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })
    expect(failingContents.debugger.calls.filter(call => call.method === 'Page.captureScreenshot')).toHaveLength(3)

    const invalidContents = new FakeWebContents()
    installTree(invalidContents, [])
    invalidContents.debugger.handlers.set('Page.captureScreenshot', () => ({ data: Buffer.from('not png').toString('base64') }))
    await expect(adapterFor(invalidContents).snapshot({ includeImage: true }))
      .rejects.toMatchObject({ code: 'INTERNAL' })

    const mismatchedContents = new FakeWebContents()
    installTree(mismatchedContents, [])
    mismatchedContents.debugger.handlers.set('Page.captureScreenshot', () => ({
      data: Buffer.from(png(99, 100)).toString('base64'),
    }))
    await expect(adapterFor(mismatchedContents, {
      viewport: () => ({ width: 100, height: 100, deviceScaleFactor: 1 }),
    }).snapshot({ includeImage: true })).rejects.toMatchObject({ code: 'INTERNAL' })

    const overflowContents = new FakeWebContents()
    installTree(overflowContents, [])
    overflowContents.debugger.handlers.set('Page.captureScreenshot', () => ({
      data: Buffer.from(png(1, 1)).toString('base64'),
    }))
    await expect(adapterFor(overflowContents, {
      viewport: () => ({ width: Number.MAX_VALUE, height: 100, deviceScaleFactor: 2 }),
    }).snapshot({ includeImage: true })).rejects.toMatchObject({ code: 'INTERNAL' })
    expect(overflowContents.debugger.calls.some(call => call.method === 'Page.captureScreenshot')).toBe(false)
  })
})

describe('BrowserSurfaceManager', () => {
  it('atomically creates and visibly mounts one unique non-persistent surface for the official session', async () => {
    const creates: { readonly sessionId: string; readonly generation: number; readonly partition: string }[] = []
    const log: string[] = []
    const manager = new BrowserSurfaceManager({
      coordinator: {
        consumeVerifiedPersistentGiveIntent: async () => undefined,
        revoke: async (sessionId, generation) => { log.push(`revoke:${sessionId}:${generation}`); return true },
        release: async () => {},
      },
      createEphemeral: async (request) => {
        creates.push(request)
        return new FakeSurface('surface-ephemeral', request.partition, 'ephemeral', log)
      },
      createNonce: () => 'nonce-one',
      createMountToken: () => 'mount-one',
    })

    const mount = await manager.acquire({ sessionId: 'official-session' })
    expect(mount).toMatchObject({
      sessionId: 'official-session', surfaceId: 'surface-ephemeral', generation: 1,
      mountToken: 'mount-one', kind: 'ephemeral', visible: true,
    })
    expect(creates).toEqual([{
      sessionId: 'official-session', generation: 1, partition: 'dsh-agent-browser-1-nonce-one',
    }])
    expect(creates[0]?.partition).not.toMatch(/^persist:/u)
    expect(creates[0]?.partition).not.toBe('persist:dsh-workbench-browser')
    expect(log.slice(0, 2)).toEqual(['guards:1', 'mount:mount-one'])
  })

  it('returns BUSY to another session without reveal, hide, remount, or intent consumption', async () => {
    const owner = new FakeSurface('owner', 'dsh-agent-browser-1-owner', 'ephemeral')
    const consume = vi.fn(async () => undefined)
    const create = vi.fn(async () => owner)
    const manager = new BrowserSurfaceManager({
      coordinator: { consumeVerifiedPersistentGiveIntent: consume, revoke: async () => true, release: async () => {} },
      createEphemeral: create,
      createNonce: () => 'owner',
      createMountToken: () => 'mount-owner',
    })
    const first = await manager.acquire({ sessionId: 'owner-session' })
    const logBefore = [...owner.log]

    await expect(manager.acquire({ sessionId: 'foreign-session' })).rejects.toMatchObject({ code: 'BUSY' })
    await expect(manager.hide({
      sessionId: 'foreign-session', generation: first.generation, mountToken: first.mountToken,
    })).rejects.toMatchObject({ code: 'BUSY' })
    expect(owner.log).toEqual(logBefore)
    expect(owner.visible).toBe(true)
    expect(consume).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledOnce()
  })

  it('reserves the official owner atomically while its first surface is still opening', async () => {
    let finishIntent: (() => void) | undefined
    const intent = new Promise<void>((resolve) => { finishIntent = resolve })
    const surface = new FakeSurface('owner', 'dsh-agent-browser-1-owner', 'ephemeral')
    const manager = new BrowserSurfaceManager({
      coordinator: {
        consumeVerifiedPersistentGiveIntent: async () => { await intent; return undefined },
        revoke: async () => true,
        release: async () => {},
      },
      createEphemeral: async () => surface,
      createNonce: () => 'owner',
      createMountToken: () => 'mount-owner',
    })

    const owner = manager.acquire({ sessionId: 'owner-session' })
    await expect(manager.acquire({ sessionId: 'foreign-session' })).rejects.toMatchObject({ code: 'BUSY' })
    expect(surface.log).toEqual([])
    finishIntent?.()
    await expect(owner).resolves.toMatchObject({ sessionId: 'owner-session', visible: true })
  })

  it('reuses only the exact owner session and generation', async () => {
    const surface = new FakeSurface('surface', 'dsh-agent-browser-1-owner', 'ephemeral')
    const manager = new BrowserSurfaceManager({
      coordinator: {
        consumeVerifiedPersistentGiveIntent: async () => undefined,
        revoke: async () => true, release: async () => {},
      },
      createEphemeral: async () => surface,
      createNonce: () => 'owner',
      createMountToken: () => 'mount-owner',
    })
    const first = await manager.acquire({ sessionId: 'owner-session' })
    await expect(manager.acquire({ sessionId: 'owner-session' })).rejects.toMatchObject({ code: 'STALE_REF' })
    await expect(manager.acquire({ sessionId: 'owner-session', expectedGeneration: first.generation + 1 }))
      .rejects.toMatchObject({ code: 'STALE_REF' })
    await expect(manager.acquire({ sessionId: 'owner-session', expectedGeneration: first.generation }))
      .resolves.toEqual(first)
    expect(surface.log.filter(item => item.startsWith('mount:'))).toHaveLength(1)
  })

  it('consumes only a coordinator-verified persistent Give intent and preserves its partition', async () => {
    const persistent = new FakeSurface(
      'human-surface', 'persist:dsh-workbench-browser', 'human-persistent',
    )
    const manager = new BrowserSurfaceManager({
      coordinator: {
        consumeVerifiedPersistentGiveIntent: async sessionId => sessionId === 'official-session' ? persistent : undefined,
        revoke: async () => true,
        release: async () => {},
      },
      createEphemeral: async () => { throw new Error('must not create ephemeral surface') },
      createNonce: () => 'unused',
      createMountToken: () => 'persistent-mount',
    })

    const mount = await manager.acquire({ sessionId: 'official-session' })
    expect(mount.kind).toBe('human-persistent')
    expect(mount.partition).toBe('persist:dsh-workbench-browser')
    await manager.stop({ sessionId: mount.sessionId, generation: mount.generation, mountToken: mount.mountToken })
    await manager.release(mount)
    expect(persistent.log).not.toContain('clear')
  })

  it('uses generation and mount token to ignore stale hide callbacks', async () => {
    const surfaces: FakeSurface[] = []
    let nonce = 0
    const manager = new BrowserSurfaceManager({
      coordinator: {
        consumeVerifiedPersistentGiveIntent: async () => undefined,
        revoke: async () => true, release: async () => {},
      },
      createEphemeral: async (request) => {
        const surface = new FakeSurface(`surface-${request.generation}`, request.partition, 'ephemeral')
        surfaces.push(surface)
        return surface
      },
      createNonce: () => `nonce-${++nonce}`,
      createMountToken: generation => `mount-${generation}`,
    })
    const first = await manager.acquire({ sessionId: 'session-one' })
    await manager.stop({ sessionId: first.sessionId, generation: first.generation, mountToken: first.mountToken })
    await manager.release(first)
    const second = await manager.acquire({ sessionId: 'session-two' })

    await expect(manager.hide({
      sessionId: first.sessionId, generation: first.generation, mountToken: first.mountToken,
    })).resolves.toBe(false)
    expect(surfaces[1]?.visible).toBe(true)
    expect(surfaces[1]?.hideCalls).toBe(0)
    expect(second.generation).toBe(2)
    expect(second.partition).not.toBe(first.partition)
  })

  it('awaits generation-owned handler disposal, debugger detach, teardown, ephemeral clearing, and revocation', async () => {
    const log: string[] = []
    const surface = new FakeSurface('surface', 'dsh-agent-browser-1-owner', 'ephemeral', log)
    const manager = new BrowserSurfaceManager({
      coordinator: {
        consumeVerifiedPersistentGiveIntent: async () => undefined,
        revoke: async (sessionId, generation) => { log.push(`revoke:${sessionId}:${generation}`); return true },
        release: async () => {},
      },
      createEphemeral: async () => surface,
      createNonce: () => 'owner',
      createMountToken: () => 'mount-owner',
    })
    const mount = await manager.acquire({ sessionId: 'owner-session' })
    await manager.stop({ sessionId: mount.sessionId, generation: mount.generation, mountToken: mount.mountToken })

    expect(log).toEqual([
      'guards:1', 'mount:mount-owner', 'dispose-guards:1', 'detach', 'teardown', 'clear',
      'revoke:owner-session:1',
    ])
    expect(surface.commitCalls).toBe(1)
    expect(surface.releaseCalls).toBe(0)
    await manager.release(mount)
    expect(surface.releaseCalls).toBe(1)
    await expect(manager.stop({
      sessionId: mount.sessionId, generation: mount.generation, mountToken: mount.mountToken,
    })).resolves.toBeUndefined()
  })

  it('runs every Stop cleanup after one failure and keeps ownership fail closed', async () => {
    const log: string[] = []
    const surface = new FakeSurface('surface', 'dsh-agent-browser-1-owner', 'ephemeral', log)
    let disposeAttempts = 0
    surface.installSecurityHandlers = (generation) => {
      log.push(`guards:${generation}`)
      return { dispose: () => {
        log.push(`dispose-guards:${generation}`)
        disposeAttempts += 1
        if (disposeAttempts === 1) throw new Error('dispose failed')
      } }
    }
    const manager = new BrowserSurfaceManager({
      coordinator: {
        consumeVerifiedPersistentGiveIntent: async () => undefined,
        revoke: async (sessionId, generation) => { log.push(`revoke:${sessionId}:${generation}`); return true },
        release: async () => {},
      },
      createEphemeral: async request => request.generation === 1
        ? surface
        : new FakeSurface('replacement', request.partition, 'ephemeral'),
      createNonce: () => 'owner',
      createMountToken: () => 'mount-owner',
    })
    const mount = await manager.acquire({ sessionId: 'owner-session' })

    await expect(manager.stop(mount)).rejects.toMatchObject({ code: 'INTERNAL' })
    expect(log).toEqual([
      'guards:1', 'mount:mount-owner', 'dispose-guards:1', 'detach', 'teardown', 'clear',
      'revoke:owner-session:1',
    ])
    expect(surface.commitCalls).toBe(1)
    expect(surface.releaseCalls).toBe(0)
    await expect(manager.acquire({ sessionId: 'other-session' })).rejects.toMatchObject({ code: 'BUSY' })

    await expect(manager.stop(mount)).resolves.toBeUndefined()
    expect(log.filter(item => item === 'dispose-guards:1')).toHaveLength(2)
    expect(log.filter(item => item === 'detach')).toHaveLength(1)
    expect(surface.releaseCalls).toBe(0)
    await expect(manager.acquire({ sessionId: 'other-session' })).rejects.toMatchObject({ code: 'BUSY' })

    await manager.release(mount)
    expect(surface.releaseCalls).toBe(1)
    await expect(manager.acquire({ sessionId: 'other-session' })).resolves.toMatchObject({ generation: 2 })
  })

  it('keeps a failed-mount cleanup reservation BUSY until lifecycle-only retry succeeds', async () => {
    const log: string[] = []
    const failed = new FakeSurface('surface', 'dsh-agent-browser-1-owner', 'ephemeral', log)
    let disposeAttempts = 0
    failed.installSecurityHandlers = (generation) => {
      log.push(`guards:${generation}`)
      return { dispose: () => {
        log.push(`dispose-guards:${generation}`)
        disposeAttempts += 1
        if (disposeAttempts < 3) throw new Error('dispose failed')
      } }
    }
    failed.mount = async (mountToken) => { log.push(`mount:${mountToken}`); throw new Error('mount failed') }
    const replacement = new FakeSurface('replacement', 'dsh-agent-browser-2-next', 'ephemeral', log)
    let createCalls = 0
    const manager = new BrowserSurfaceManager({
      coordinator: {
        consumeVerifiedPersistentGiveIntent: async () => undefined,
        revoke: async (sessionId, generation) => { log.push(`revoke:${sessionId}:${generation}`); return true },
        release: async () => {},
      },
      createEphemeral: async () => createCalls++ === 0 ? failed : replacement,
      createNonce: () => createCalls === 0 ? 'owner' : 'next',
      createMountToken: generation => `mount-${generation}`,
    })

    await expect(manager.acquire({ sessionId: 'owner-session' })).rejects.toMatchObject({ code: 'INTERNAL' })
    expect(log).toEqual([
      'guards:1', 'mount:mount-1', 'dispose-guards:1', 'detach', 'teardown', 'clear',
      'revoke:owner-session:1',
    ])
    expect(failed.commitCalls).toBe(0)
    expect(failed.releaseCalls).toBe(0)
    await expect(manager.acquire({ sessionId: 'next-session' })).rejects.toMatchObject({ code: 'BUSY' })
    expect(createCalls).toBe(1)
    await expect(manager.retryFailedMountCleanup({ sessionId: 'next-session', generation: 1 }))
      .rejects.toMatchObject({ code: 'BUSY' })
    await expect(manager.retryFailedMountCleanup({ sessionId: 'owner-session', generation: 2 }))
      .rejects.toMatchObject({ code: 'STALE_REF' })

    await expect(manager.retryFailedMountCleanup({ sessionId: 'owner-session', generation: 1 }))
      .rejects.toMatchObject({ code: 'INTERNAL' })
    expect(log.filter(item => item === 'dispose-guards:1')).toHaveLength(2)
    expect(log.filter(item => item === 'detach')).toHaveLength(1)
    await expect(manager.acquire({ sessionId: 'next-session' })).rejects.toMatchObject({ code: 'BUSY' })

    await manager.retryFailedMountCleanup({ sessionId: 'owner-session', generation: 1 })
    expect(log.filter(item => item === 'dispose-guards:1')).toHaveLength(3)
    expect(failed.releaseCalls).toBe(1)
    await expect(manager.acquire({ sessionId: 'next-session' })).resolves.toMatchObject({
      sessionId: 'next-session', generation: 2, surfaceId: 'replacement', visible: true,
    })
  })

  it('revokes its reservation when ephemeral creation fails before returning a resource', async () => {
    const revoke = vi.fn(async () => false)
    const release = vi.fn(async () => { throw new Error('no exact owner to release') })
    const manager = new BrowserSurfaceManager({
      coordinator: { consumeVerifiedPersistentGiveIntent: async () => undefined, revoke, release },
      createEphemeral: async () => { throw new Error('creation failed') },
      createNonce: () => 'owner',
    })

    await expect(manager.acquire({ sessionId: 'owner-session' })).rejects.toMatchObject({ code: 'INTERNAL' })
    expect(revoke).toHaveBeenCalledWith('owner-session', 1)
    expect(release).not.toHaveBeenCalled()
  })
})
