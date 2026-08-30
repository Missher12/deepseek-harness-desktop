import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { performance } from 'node:perf_hooks'
import {
  AgentBrowserError,
  BROWSER_AGENT_LIMITS,
  isAgentBrowserAction,
  type AgentBrowserAction,
  type AgentBrowserImageMetadata,
  type AgentBrowserRef,
  type AgentBrowserSemanticRef,
  type AgentBrowserSnapshotEnvelope,
  type AgentBrowserSnapshotResult,
} from './contracts.ts'
import {
  classifyBrowserTarget,
  type AgentBrowserResolvedNavigation,
  type AgentBrowserUrlPolicy,
} from './policy.ts'

type Listener = (...args: unknown[]) => void

/** Minimal Electron debugger face consumed by the closed adapter. */
export interface BrowserDebuggerPort {
  isAttached(): boolean
  attach(protocolVersion?: string): void
  detach(): void
  sendCommand(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown>
  on(event: string, listener: Listener): unknown
  removeListener(event: string, listener: Listener): unknown
}

/** Minimal WebContents face consumed without exposing it through the provider API. */
export interface BrowserAdapterWebContents {
  readonly debugger: BrowserDebuggerPort
  readonly navigationHistory: {
    canGoBack(): boolean
    canGoForward(): boolean
    getActiveIndex(): number
    getEntryAtIndex(index: number): {
      readonly url: string
      readonly title?: string
      readonly pageState?: string
    } | null | undefined
    goToIndex(index: number): void
  }
  isDestroyed(): boolean
  isLoading(): boolean
  getURL(): string
  getTitle(): string
  loadURL(url: string): Promise<unknown>
  reload(): void
  on(event: string, listener: Listener): unknown
  removeListener(event: string, listener: Listener): unknown
}

/** Visible viewport geometry used to choose a deterministic capture scale before CDP capture. */
export interface BrowserViewport {
  readonly width: number
  readonly height: number
  readonly deviceScaleFactor: number
}

/** Hostname transport contract implemented by Task 8 with an address-pinning HTTPS CONNECT proxy. */
export interface AgentBrowserPinnedNavigationRequest {
  readonly url: string
  readonly signal?: AbortSignal
  readonly resolveAndValidate: (url: string, signal?: AbortSignal) => Promise<AgentBrowserResolvedNavigation>
  readonly commit: () => Promise<void>
}

/**
 * Loads through a surface-owned transport that connects only to an address returned by
 * resolveAndValidate while preserving the original URL hostname, HTTPS SNI, and certificate checks.
 */
export interface AgentBrowserPinnedNavigationTransport {
  load(request: AgentBrowserPinnedNavigationRequest): Promise<void>
}

/** Construction dependencies kept narrow for Electron integration and deterministic tests. */
export interface CdpBrowserAdapterOptions {
  readonly webContents: BrowserAdapterWebContents
  readonly surfaceId: string
  readonly surfaceGeneration: number
  readonly viewport: () => BrowserViewport
  readonly urlPolicy: Pick<AgentBrowserUrlPolicy, 'authorize' | 'resolveForConnect'>
  readonly pinnedNavigationTransport?: AgentBrowserPinnedNavigationTransport
  readonly now?: () => number
  readonly delay?: (durationMs: number, signal?: AbortSignal) => Promise<void>
  readonly createTransferId?: () => string
  /** Content-free native diagnostics; never receives URLs, labels, refs, or page text. */
  readonly diagnostic?: (event: CdpBrowserDiagnostic) => void
}

export interface CdpBrowserDiagnostic {
  readonly phase: 'start' | 'accessibility' | 'projection' | 'screenshot' | 'fit'
  readonly code: AgentBrowserError['code']
}

type AllowedCdpMethod =
  | 'Accessibility.enable'
  | 'Accessibility.disable'
  | 'Accessibility.getRootAXNode'
  | 'Accessibility.getChildAXNodes'
  | 'DOM.enable'
  | 'DOM.disable'
  | 'DOM.describeNode'
  | 'DOM.getBoxModel'
  | 'Input.dispatchMouseEvent'
  | 'Input.dispatchKeyEvent'
  | 'Input.insertText'
  | 'Overlay.enable'
  | 'Overlay.disable'
  | 'Overlay.highlightQuad'
  | 'Overlay.hideHighlight'
  | 'Page.captureScreenshot'
  | 'Page.setInterceptFileChooserDialog'

interface OperationBudget {
  readonly epoch: number
  readonly startedAt: number
  readonly wallMs: number
  calls: number
}

interface AxNode {
  readonly nodeId: string
  readonly backendDOMNodeId?: number
  readonly childIds: readonly string[]
  readonly ignored: boolean
  readonly role: string
  readonly name: string
  readonly disabled: boolean
  readonly readonly: boolean
  readonly focused: boolean
}

interface BrowserReferenceBinding {
  readonly ref: AgentBrowserRef
  readonly axNodeId: string
  readonly backendDOMNodeId: number
  readonly role: string
  readonly name: string
  readonly editable: boolean
  readonly selectable: boolean
  readonly revision: number
  readonly epoch: number
}

interface BrowserHistorySnapshot {
  readonly activeIndex: number
  readonly targetIndex: number
  readonly sourceUrl: string
  readonly activeEntry: Readonly<{ url: string; title?: string; pageState?: string }>
  readonly targetEntry: Readonly<{ url: string; title?: string; pageState?: string }>
}

interface CandidateReference {
  readonly semantic: AgentBrowserSemanticRef
  readonly binding: BrowserReferenceBinding
  readonly line: string
}

interface AccessibilityWalk {
  readonly nodes: readonly AxNode[]
  readonly truncated: boolean
}

interface CandidateProjection {
  readonly candidates: readonly CandidateReference[]
  readonly truncated: boolean
}

const ACTIONABLE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'textbox', 'searchbox', 'combobox',
  'listbox', 'menuitem', 'option', 'tab', 'switch', 'spinbutton',
])
const EDITABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton'])
const SELECTABLE_ROLES = new Set(['combobox', 'listbox'])
const MATERIAL_TREE_EVENTS = new Set(['Accessibility.nodesUpdated', 'DOM.documentUpdated'])
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const TRANSFER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const utf8 = new TextEncoder()
const PARTIAL_SNAPSHOT_LINE = '[Partial snapshot: page content was pruned to bounded actionable controls.]'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function hasPreventDefault(value: unknown): value is { preventDefault(): void } {
  const source = record(value)
  return typeof source?.preventDefault === 'function'
}

function stringValue(value: unknown): string {
  const source = record(value)
  return typeof source?.value === 'string' ? source.value : ''
}

function booleanProperty(value: unknown, name: string): boolean {
  if (!Array.isArray(value)) return false
  for (const property of value) {
    const source = record(property)
    if (source?.name === name) return record(source.value)?.value === true
  }
  return false
}

function axNode(value: unknown): AxNode | undefined {
  const source = record(value)
  if (source === undefined || typeof source.nodeId !== 'string') return undefined
  const childIds = Array.isArray(source.childIds)
    ? source.childIds.filter((item): item is string => typeof item === 'string')
    : []
  return {
    nodeId: source.nodeId,
    ...(typeof source.backendDOMNodeId === 'number' && Number.isSafeInteger(source.backendDOMNodeId)
      ? { backendDOMNodeId: source.backendDOMNodeId }
      : {}),
    childIds,
    ignored: source.ignored === true,
    role: stringValue(source.role).toLowerCase(),
    name: stringValue(source.name),
    disabled: booleanProperty(source.properties, 'disabled'),
    readonly: booleanProperty(source.properties, 'readonly'),
    focused: booleanProperty(source.properties, 'focused'),
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8.encode(value).byteLength <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2)
    if (utf8.encode(value.slice(0, midpoint)).byteLength <= maxBytes) low = midpoint
    else high = midpoint - 1
  }
  let result = value.slice(0, low)
  while (result.length > 0 && /[\uD800-\uDBFF]$/u.test(result)) result = result.slice(0, -1)
  return result
}

function attributes(value: unknown): Readonly<Record<string, string | boolean>> {
  const node = record(record(value)?.node)
  const raw = node?.attributes
  if (!Array.isArray(raw)) return Object.freeze({})
  const rawAttributes = raw as readonly unknown[]
  const result: Record<string, string | boolean> = {}
  for (let index = 0; index + 1 < rawAttributes.length; index += 2) {
    const name = rawAttributes[index]
    const item = rawAttributes[index + 1]
    if (typeof name !== 'string' || typeof item !== 'string') continue
    const normalized = name.toLowerCase()
    if (normalized === 'type' || normalized === 'autocomplete') result[normalized] = item
    else if (normalized === 'disabled' || normalized === 'readonly') result[normalized] = true
  }
  return Object.freeze(result)
}

function defaultDelay(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(new AgentBrowserError('CANCELLED', 'browser wait was cancelled'))
  return new Promise((resolve, reject) => {
    const done = (): void => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const abort = (): void => {
      clearTimeout(timer)
      reject(new AgentBrowserError('CANCELLED', 'browser wait was cancelled'))
    }
    const timer = setTimeout(done, durationMs)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function pngDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } {
  if (bytes.byteLength < 24 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new AgentBrowserError('INTERNAL', 'browser screenshot is not a PNG')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(8) !== 13 || bytes[12] !== 0x49 || bytes[13] !== 0x48
    || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    throw new AgentBrowserError('INTERNAL', 'browser screenshot has an invalid IHDR')
  }
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width < 1 || height < 1) throw new AgentBrowserError('INTERNAL', 'browser screenshot has invalid dimensions')
  return { width, height }
}

function decodedPng(value: unknown): Uint8Array | undefined {
  const source = record(value)
  if (typeof source?.data !== 'string' || source.data.length === 0) {
    throw new AgentBrowserError('INTERNAL', 'browser screenshot encoding is invalid')
  }
  const maximumEncodedLength = Math.ceil(BROWSER_AGENT_LIMITS.pngBytes / 3) * 4
  if (source.data.length > maximumEncodedLength) return undefined
  if (source.data.length % 4 !== 0 || !/^[A-Za-z\d+/]*={0,2}$/u.test(source.data)
    || source.data.slice(0, -2).includes('=')) {
    throw new AgentBrowserError('INTERNAL', 'browser screenshot encoding is invalid')
  }
  const padding = source.data.endsWith('==') ? 2 : source.data.endsWith('=') ? 1 : 0
  const decodedLength = source.data.length / 4 * 3 - padding
  if (decodedLength > BROWSER_AGENT_LIMITS.pngBytes) return undefined
  const decoded = Buffer.from(source.data, 'base64')
  if (decoded.byteLength !== decodedLength || decoded.toString('base64') !== source.data) {
    throw new AgentBrowserError('INTERNAL', 'browser screenshot encoding is invalid')
  }
  return new Uint8Array(decoded)
}

function keyModifiers(modifiers: readonly string[]): number {
  return modifiers.reduce((mask, modifier) => mask | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[modifier] ?? 0), 0)
}

/** Closed, revision-aware in-process CDP adapter for one Agent browser surface. */
export class CdpBrowserAdapter {
  private readonly webContents: BrowserAdapterWebContents
  private readonly surfaceId: string
  private readonly surfaceGeneration: number
  private readonly viewport: () => BrowserViewport
  private readonly urlPolicy: Pick<AgentBrowserUrlPolicy, 'authorize' | 'resolveForConnect'>
  private readonly pinnedNavigationTransport: AgentBrowserPinnedNavigationTransport | undefined
  private readonly now: () => number
  private readonly delay: (durationMs: number, signal?: AbortSignal) => Promise<void>
  private readonly createTransferId: () => string
  private readonly diagnostic: ((event: CdpBrowserDiagnostic) => void) | undefined
  private attachedByUs = false
  private listenersInstalled = false
  private stopped = false
  private stopOperation: Promise<void> | undefined
  private ownedDebuggerCleanupRequired = false
  private destroyed = false
  private epoch = 1
  private hardEpoch = 1
  private revision = 1
  private approvedNavigation: string | undefined
  private references = new Map<AgentBrowserRef, BrowserReferenceBinding>()

  constructor(options: CdpBrowserAdapterOptions) {
    this.webContents = options.webContents
    this.surfaceId = options.surfaceId
    this.surfaceGeneration = options.surfaceGeneration
    this.viewport = options.viewport
    this.urlPolicy = options.urlPolicy
    this.pinnedNavigationTransport = options.pinnedNavigationTransport
    this.now = options.now ?? (() => performance.now())
    this.delay = options.delay ?? defaultDelay
    this.createTransferId = options.createTransferId ?? randomUUID
    this.diagnostic = options.diagnostic
  }

  private readonly invalidateOnNavigation: Listener = () => { this.invalidate() }
  private readonly markDestroyed: Listener = () => {
    this.destroyed = true
    this.invalidate()
  }
  private readonly debuggerDetached: Listener = () => {
    this.attachedByUs = false
    this.invalidate()
  }
  private readonly debuggerMessage: Listener = (_event, method) => {
    if (typeof method === 'string' && MATERIAL_TREE_EVENTS.has(method)) this.invalidate('material')
  }
  private readonly guardNavigation: Listener = (event, url) => {
    if (typeof url !== 'string') {
      this.prevent(event)
      return
    }
    if (this.approvedNavigation === url) {
      this.approvedNavigation = undefined
      return
    }
    this.prevent(event)
    void this.followValidatedNavigation(url)
  }
  private readonly guardRedirect: Listener = (event, url) => {
    this.prevent(event)
    if (typeof url === 'string') void this.followValidatedNavigation(url)
  }

  /** Attach the debugger only when no foreign debugger owns it and enable file-chooser interception. */
  async start(signal?: AbortSignal): Promise<void> {
    this.assertOpen()
    if (this.attachedByUs && this.webContents.debugger.isAttached()) return
    if (this.webContents.debugger.isAttached()) {
      throw new AgentBrowserError('BUSY', 'browser surface already has a debugger')
    }
    try {
      this.webContents.debugger.attach('1.3')
      this.attachedByUs = true
      this.installListeners()
      const attemptMs = Math.floor(BROWSER_AGENT_LIMITS.startupMs / BROWSER_AGENT_LIMITS.startupAttempts)
      let initialized = false
      let failure: unknown
      for (let attempt = 0; attempt < BROWSER_AGENT_LIMITS.startupAttempts; attempt += 1) {
        try {
          const budget = this.createBudget(attemptMs)
          await this.command('Accessibility.enable', {}, budget, signal)
          // Chromium's Overlay domain requires DOM to be enabled first. The
          // fake debugger accepts either order, but the packaged Electron
          // renderer rejects Overlay.enable without this explicit handshake.
          await this.command('DOM.enable', {}, budget, signal)
          await this.command('Overlay.enable', {}, budget, signal)
          await this.command(
            'Page.setInterceptFileChooserDialog',
            { enabled: true },
            budget,
            signal,
          )
          initialized = true
          break
        } catch (error) {
          failure = error
          if (error instanceof AgentBrowserError
            && error.code !== 'INTERNAL' && error.code !== 'TIMEOUT') throw error
        }
      }
      if (!initialized) throw failure
    } catch (error) {
      const foreignDebuggerWonRace = !this.attachedByUs && this.webContents.debugger.isAttached()
      if (this.attachedByUs) {
        this.removeListeners()
        this.attachedByUs = false
        if (this.webContents.debugger.isAttached()) this.webContents.debugger.detach()
      }
      if (foreignDebuggerWonRace) {
        throw new AgentBrowserError('BUSY', 'browser surface already has a debugger')
      }
      if (error instanceof AgentBrowserError) throw error
      throw new AgentBrowserError('INTERNAL', 'browser debugger could not be initialized')
    }
  }

  /** Capture a bounded semantic snapshot and optional verified visible-viewport PNG. */
  async snapshot(
    request: { readonly includeImage: boolean },
    signal?: AbortSignal,
  ): Promise<AgentBrowserSnapshotEnvelope> {
    await this.runDiagnosticStage('start', async () => { await this.start(signal) })
    const startedAt = this.now()
    const hardEpoch = this.hardEpoch
    let failure: unknown
    for (let attempt = 0; attempt < BROWSER_AGENT_LIMITS.snapshotAttempts; attempt += 1) {
      const attemptEpoch = this.epoch
      try {
        return await this.snapshotAttempt(request, startedAt, signal)
      } catch (error) {
        failure = error
        const materialTreeChanged = error instanceof AgentBrowserError
          && error.code === 'STALE_REF'
          && this.hardEpoch === hardEpoch
          && this.epoch !== attemptEpoch
        if (!materialTreeChanged || attempt + 1 >= BROWSER_AGENT_LIMITS.snapshotAttempts) throw error
      }
    }
    throw failure
  }

  private async snapshotAttempt(
    request: { readonly includeImage: boolean },
    startedAt: number,
    signal?: AbortSignal,
  ): Promise<AgentBrowserSnapshotEnvelope> {
    this.assertSignal(signal)
    const remainingMs = BROWSER_AGENT_LIMITS.wallMs - (this.now() - startedAt)
    if (remainingMs <= 0) {
      throw new AgentBrowserError('TIMEOUT', 'browser operation exceeded its wall-time bound')
    }
    const budget = this.createBudget(remainingMs)
    const walk = await this.runDiagnosticStage(
      'accessibility',
      async () => await this.walkAccessibilityTree(budget, signal),
    )
    const projection = await this.runDiagnosticStage(
      'projection',
      async () => await this.projectCandidates(walk.nodes, budget, signal),
    )
    let image: Awaited<ReturnType<CdpBrowserAdapter['captureScreenshot']>> | undefined
    if (request.includeImage) {
      try {
        image = await this.captureScreenshot(budget, signal)
      } catch (error) {
        // PNG is an optional presentation aid. A renderer-specific capture,
        // encoding, or bounded-time failure must not discard an already
        // verified semantic tree and its revision-bound refs.
        if (!(error instanceof AgentBrowserError)
          || !['INTERNAL', 'TIMEOUT', 'QUOTA_EXCEEDED'].includes(error.code)) throw error
        this.reportDiagnostic('screenshot', error)
      }
    }
    this.assertEpoch(budget.epoch)
    let fitted: ReturnType<CdpBrowserAdapter['fitResult']>
    try {
      fitted = this.fitResult(
        projection.candidates,
        image?.metadata,
        walk.truncated || projection.truncated,
      )
    } catch (error) {
      this.reportDiagnostic('fit', error)
      throw error
    }
    this.references = new Map(fitted.bindings.map(binding => [binding.ref, binding]))
    if (image === undefined) {
      return Object.freeze({
        result: Object.freeze({
          surfaceId: fitted.result.surfaceId,
          url: fitted.result.url,
          title: fitted.result.title,
          snapshotRevision: fitted.result.snapshotRevision,
          semanticText: fitted.result.semanticText,
          refs: fitted.result.refs,
        }),
      })
    }
    return Object.freeze({
      result: Object.freeze({ ...fitted.result, image: image.metadata }),
      png: new Uint8Array(image.png),
    })
  }

  /** Execute one closed semantic browser action without exposing coordinates or generic CDP. */
  async act(action: AgentBrowserAction, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    if (!isAgentBrowserAction(action)) throw new AgentBrowserError('POLICY_DENIED', 'browser action is not allowed')
    await this.start(signal)
    this.assertSignal(signal)
    if (action.kind === 'navigate') {
      const target = await this.urlPolicy.authorize(action.url, signal)
      this.assertOpen()
      this.invalidate()
      await this.loadAuthorized(target, signal)
      return Object.freeze({ url: target, snapshotRevision: this.revision })
    }
    if (action.kind === 'back' || action.kind === 'forward') {
      const history = this.webContents.navigationHistory
      const offset = action.kind === 'back' ? -1 : 1
      const allowed = offset === -1 ? history.canGoBack() : history.canGoForward()
      if (!allowed) {
        this.invalidate()
        return Object.freeze({ url: this.webContents.getURL(), snapshotRevision: this.revision })
      }
      const historySnapshot = this.captureHistorySnapshot(offset)
      if (offset === -1 && historySnapshot.targetIndex === 0
        && historySnapshot.targetEntry.url === 'about:blank') {
        this.invalidate()
        return Object.freeze({ url: historySnapshot.sourceUrl, snapshotRevision: this.revision })
      }
      const authorizationRevision = this.revision
      const target = await this.urlPolicy.authorize(historySnapshot.targetEntry.url, signal)
      this.assertHistorySnapshot(historySnapshot, authorizationRevision, offset)
      this.invalidate()
      const commitRevision = this.revision
      await this.loadAuthorized(target, signal, () => {
        this.assertHistorySnapshot(historySnapshot, commitRevision, offset)
        history.goToIndex(historySnapshot.targetIndex)
      })
      return Object.freeze({ url: target, snapshotRevision: this.revision })
    }
    if (action.kind === 'reload') {
      const sourceUrl = this.webContents.getURL()
      const authorizationRevision = this.revision
      const target = await this.urlPolicy.authorize(sourceUrl, signal)
      this.assertReloadState(sourceUrl, authorizationRevision)
      this.invalidate()
      const commitRevision = this.revision
      await this.loadAuthorized(target, signal, () => {
        this.assertReloadState(sourceUrl, commitRevision)
        this.webContents.reload()
      })
      return Object.freeze({ url: target, snapshotRevision: this.revision })
    }
    if (action.kind === 'wait') {
      await this.wait(action, signal)
      return Object.freeze({ waited: true, snapshotRevision: this.revision })
    }
    const budget = this.createBudget()
    if (action.kind === 'key') await this.pressKey(action.key, action.modifiers, budget, signal)
    else if (action.kind === 'scroll') {
      const binding = action.ref === undefined
        ? undefined
        : await this.revalidateBinding(this.currentBinding(action.ref), budget, signal)
      await this.scroll(binding, action.deltaX, action.deltaY, budget, signal)
    }
    else {
      const binding = await this.revalidateBinding(this.currentBinding(action.ref), budget, signal)
      if (action.kind === 'click') await this.click(binding, budget, signal)
      else if (action.kind === 'type') {
        if (!binding.editable) throw new AgentBrowserError('POLICY_DENIED', 'browser target is not editable')
        await this.click(binding, budget, signal)
        const focused = await this.revalidateBinding(binding, budget, signal, true)
        if (!focused.editable) throw new AgentBrowserError('POLICY_DENIED', 'browser target is no longer editable')
        await this.command('Input.insertText', { text: action.text }, budget, signal)
      } else {
        if (!binding.selectable) throw new AgentBrowserError('POLICY_DENIED', 'browser target is not selectable')
        await this.click(binding, budget, signal)
        const focused = await this.revalidateBinding(binding, budget, signal, true)
        if (!focused.selectable) throw new AgentBrowserError('POLICY_DENIED', 'browser target is no longer selectable')
        await this.command('Input.insertText', { text: action.value }, budget, signal)
        const stillFocused = await this.revalidateBinding(focused, budget, signal, true)
        if (!stillFocused.selectable) throw new AgentBrowserError('POLICY_DENIED', 'browser target is no longer selectable')
        await this.pressKey('Enter', [], budget, signal)
      }
    }
    return Object.freeze({ acted: true, snapshotRevision: this.revision })
  }

  /** Return the current revision without exposing any debugger or page primitive. */
  currentSnapshotRevision(): number { return this.revision }

  private async runDiagnosticStage<T>(
    phase: CdpBrowserDiagnostic['phase'],
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      this.reportDiagnostic(phase, error)
      throw error
    }
  }

  private reportDiagnostic(phase: CdpBrowserDiagnostic['phase'], error: unknown): void {
    const code = error instanceof AgentBrowserError ? error.code : 'INTERNAL'
    try { this.diagnostic?.(Object.freeze({ phase, code })) } catch { /* diagnostics are never authoritative */ }
  }

  /** Invalidate refs and detach only a debugger this adapter attached itself. */
  stop(): Promise<void> {
    if (this.stopOperation !== undefined) return this.stopOperation
    if (this.stopped && !this.ownedDebuggerCleanupRequired) return Promise.resolve()
    if (this.attachedByUs && this.webContents.debugger.isAttached()) this.ownedDebuggerCleanupRequired = true
    this.attachedByUs = false
    if (!this.stopped) {
      this.stopped = true
      this.removeListeners()
      this.invalidate()
    }
    const operation = this.releaseOwnedDebugger()
    this.stopOperation = operation
    void operation.finally(() => { this.stopOperation = undefined }).catch(() => {
      // The caller awaits the original cleanup failure; a lifecycle retry is allowed afterward.
    })
    return operation
  }

  private async releaseOwnedDebugger(): Promise<void> {
    if (!this.ownedDebuggerCleanupRequired) return
    try {
      await this.awaitCdpResponse(
        this.webContents.debugger.sendCommand('Accessibility.disable', {}),
        BROWSER_AGENT_LIMITS.cleanupMs,
      )
    } catch {
      // Detach below also disables Accessibility for the owned debugger session.
    }
    try {
      await this.awaitCdpResponse(
        this.webContents.debugger.sendCommand('DOM.disable', {}),
        BROWSER_AGENT_LIMITS.cleanupMs,
      )
    } catch {
      // Detach below also disables DOM for the owned debugger session.
    }
    try {
      await this.awaitCdpResponse(
        this.webContents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }),
        BROWSER_AGENT_LIMITS.cleanupMs,
      )
    } catch {
      // Detach below is itself sufficient to remove an owned debugger's chooser interception.
    }
    try {
      await this.awaitCdpResponse(
        this.webContents.debugger.sendCommand('Overlay.hideHighlight', {}),
        BROWSER_AGENT_LIMITS.cleanupMs,
      )
      await this.awaitCdpResponse(
        this.webContents.debugger.sendCommand('Overlay.disable', {}),
        BROWSER_AGENT_LIMITS.cleanupMs,
      )
    } catch {
      // Detach below also removes the main-owned visual Agent pointer.
    }
    try {
      if (this.webContents.debugger.isAttached()) this.webContents.debugger.detach()
    } catch {
      // The attachment state below is authoritative for whether lifecycle retry is required.
    }
    if (this.webContents.debugger.isAttached()) {
      throw new AgentBrowserError('INTERNAL', 'browser debugger cleanup did not reach quiescence')
    }
    this.ownedDebuggerCleanupRequired = false
  }

  private createBudget(wallMs: number = BROWSER_AGENT_LIMITS.wallMs): OperationBudget {
    return { epoch: this.epoch, startedAt: this.now(), wallMs, calls: 0 }
  }

  private async command(
    method: AllowedCdpMethod,
    params: Readonly<Record<string, unknown>>,
    budget: OperationBudget,
    signal?: AbortSignal,
  ): Promise<unknown> {
    this.assertSignal(signal)
    this.assertEpoch(budget.epoch)
    if (this.now() - budget.startedAt > budget.wallMs) {
      throw new AgentBrowserError('TIMEOUT', 'browser operation exceeded its wall-time bound')
    }
    budget.calls += 1
    if (budget.calls > BROWSER_AGENT_LIMITS.cdpCalls) {
      budget.calls -= 1
      throw new AgentBrowserError('QUOTA_EXCEEDED', 'browser operation exceeded its CDP call bound')
    }
    let result: unknown
    try {
      const response = this.webContents.debugger.sendCommand(method, params)
      const remainingMs = Math.max(0, budget.wallMs - (this.now() - budget.startedAt))
      result = await this.awaitCdpResponse(response, remainingMs, signal)
    } catch (error) {
      this.assertSignal(signal)
      this.assertEpoch(budget.epoch)
      if (error instanceof AgentBrowserError) throw error
      throw new AgentBrowserError('INTERNAL', 'browser debugger command failed')
    }
    this.assertSignal(signal)
    this.assertEpoch(budget.epoch)
    if (this.now() - budget.startedAt > budget.wallMs) {
      throw new AgentBrowserError('TIMEOUT', 'browser operation exceeded its wall-time bound')
    }
    return result
  }

  private async awaitCdpResponse(
    response: Promise<unknown>,
    remainingMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return await new Promise<unknown>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', aborted)
        callback()
      }
      const aborted = (): void => {
        finish(() => { reject(new AgentBrowserError('CANCELLED', 'browser operation was cancelled')) })
      }
      const timer = setTimeout(() => {
        finish(() => { reject(new AgentBrowserError('TIMEOUT', 'browser operation exceeded its wall-time bound')) })
      }, remainingMs)
      response.then(
        (value) => { finish(() => { resolve(value) }) },
        (error: unknown) => {
          const failure = error instanceof Error ? error : new Error('browser debugger command failed')
          finish(() => { reject(failure) })
        },
      )
      signal?.addEventListener('abort', aborted, { once: true })
      if (signal?.aborted === true) aborted()
    })
  }

  private async walkAccessibilityTree(budget: OperationBudget, signal?: AbortSignal): Promise<AccessibilityWalk> {
    let root: AxNode | undefined
    for (let attempt = 0; attempt < BROWSER_AGENT_LIMITS.accessibilityAttempts; attempt += 1) {
      const rootResponse = record(await this.command('Accessibility.getRootAXNode', {}, budget, signal))
      root = axNode(rootResponse?.node)
      if (root !== undefined) break
      if (attempt + 1 < BROWSER_AGENT_LIMITS.accessibilityAttempts) {
        await this.delay(BROWSER_AGENT_LIMITS.accessibilityRetryMs, signal)
        this.assertEpoch(budget.epoch)
      }
    }
    if (root === undefined) throw new AgentBrowserError('INTERNAL', 'browser accessibility root is unavailable')
    const nodes: AxNode[] = [root]
    const queue: { readonly node: AxNode; readonly depth: number }[] = [{ node: root, depth: 0 }]
    let cursor = 0
    let truncated = false
    const traversalCallLimit = BROWSER_AGENT_LIMITS.cdpCalls - BROWSER_AGENT_LIMITS.actionableNodes
    while (cursor < queue.length) {
      const entry = queue[cursor++]
      if (entry === undefined || entry.depth >= BROWSER_AGENT_LIMITS.depth || entry.node.childIds.length === 0) continue
      if (budget.calls >= traversalCallLimit) {
        truncated = true
        break
      }
      const response = record(await this.command(
        'Accessibility.getChildAXNodes',
        { id: entry.node.nodeId },
        budget,
        signal,
      ))
      if (!Array.isArray(response?.nodes)) throw new AgentBrowserError('INTERNAL', 'browser accessibility children are invalid')
      const remaining = BROWSER_AGENT_LIMITS.rawNodes - nodes.length
      const acceptedRaw = response.nodes.slice(0, Math.max(0, remaining))
      if (acceptedRaw.length < response.nodes.length) truncated = true
      for (const raw of acceptedRaw) {
        const child = axNode(raw)
        if (child === undefined) throw new AgentBrowserError('INTERNAL', 'browser accessibility node is invalid')
        nodes.push(child)
        queue.push({ node: child, depth: entry.depth + 1 })
      }
      if (truncated) break
    }
    return { nodes, truncated }
  }

  private async projectCandidates(
    nodes: readonly AxNode[],
    budget: OperationBudget,
    signal?: AbortSignal,
  ): Promise<CandidateProjection> {
    const candidates: CandidateReference[] = []
    const actionable = nodes
      .filter(node => !node.ignored && ACTIONABLE_ROLES.has(node.role) && node.backendDOMNodeId !== undefined)
      .sort((left, right) => {
        const priority = (node: AxNode): number => node.focused || EDITABLE_ROLES.has(node.role)
          || node.role === 'button' || node.role === 'switch'
          ? 0
          : node.role === 'link' ? 2 : 1
        return priority(left) - priority(right)
      })
    let truncated = actionable.length > BROWSER_AGENT_LIMITS.actionableNodes
    for (const node of actionable) {
      if (candidates.length >= BROWSER_AGENT_LIMITS.actionableNodes) break
      if (budget.calls >= BROWSER_AGENT_LIMITS.cdpCalls) {
        truncated = true
        break
      }
      // The filter above proves the backend identity exists.
      const backendDOMNodeId = node.backendDOMNodeId
      if (backendDOMNodeId === undefined) continue
      const editable = EDITABLE_ROLES.has(node.role)
      const targetAttributes = attributes(await this.command(
        'DOM.describeNode',
        { backendNodeId: backendDOMNodeId, depth: 0, pierce: false },
        budget,
        signal,
      ))
      const name = truncateUtf8(node.name, 1_024)
      if (classifyBrowserTarget({
        role: node.role,
        name,
        editable,
        ...(typeof targetAttributes.type === 'string' ? { type: targetAttributes.type } : {}),
        ...(typeof targetAttributes.autocomplete === 'string' ? { autocomplete: targetAttributes.autocomplete } : {}),
        disabled: node.disabled || targetAttributes.disabled === true,
        readonly: node.readonly || targetAttributes.readonly === true,
      }) === 'DENY') continue
      const role = truncateUtf8(node.role, 128)
      const ref = this.createRef(node, candidates.length)
      const semantic = Object.freeze({ ref, role, name })
      const binding = Object.freeze({
        ref,
        axNodeId: node.nodeId,
        backendDOMNodeId,
        role,
        name,
        editable,
        selectable: SELECTABLE_ROLES.has(node.role),
        revision: this.revision,
        epoch: budget.epoch,
      })
      candidates.push({ semantic, binding, line: `${role} ${JSON.stringify(name)} [ref=${ref}]` })
    }
    return { candidates, truncated }
  }

  private fitResult(
    candidates: readonly CandidateReference[],
    image?: AgentBrowserImageMetadata,
    sourceTruncated = false,
  ): { readonly result: AgentBrowserSnapshotResult; readonly bindings: readonly BrowserReferenceBinding[] } {
    const assemble = (showPartial: boolean): {
      readonly accepted: CandidateReference[]
      readonly semanticText: string
      readonly clipped: boolean
    } => {
      const accepted: CandidateReference[] = []
      let semanticText = showPartial ? PARTIAL_SNAPSHOT_LINE : ''
      let clipped = false
      for (const candidate of candidates) {
        const nextText = semanticText === '' ? candidate.line : `${semanticText}\n${candidate.line}`
        if (utf8.encode(nextText).byteLength > BROWSER_AGENT_LIMITS.semanticUtf8Bytes) {
          clipped = true
          break
        }
        const candidateResult: AgentBrowserSnapshotResult = {
          surfaceId: this.surfaceId,
          url: this.webContents.getURL(),
          title: truncateUtf8(this.webContents.getTitle(), 2_048),
          snapshotRevision: this.revision,
          semanticText: nextText,
          refs: [...accepted.map(item => item.semantic), candidate.semantic],
          ...image === undefined ? {} : { image },
        }
        if (utf8.encode(JSON.stringify(candidateResult)).byteLength > BROWSER_AGENT_LIMITS.encodedJsonBytes) {
          clipped = true
          break
        }
        accepted.push(candidate)
        semanticText = nextText
      }
      return { accepted, semanticText, clipped }
    }
    let assembled = assemble(sourceTruncated)
    if (!sourceTruncated && assembled.clipped) assembled = assemble(true)
    const { accepted, semanticText } = assembled
    const result: AgentBrowserSnapshotResult = Object.freeze({
      surfaceId: this.surfaceId,
      url: this.webContents.getURL(),
      title: truncateUtf8(this.webContents.getTitle(), 2_048),
      snapshotRevision: this.revision,
      semanticText,
      refs: Object.freeze(accepted.map(item => item.semantic)),
      ...image === undefined ? {} : { image },
    })
    if (utf8.encode(JSON.stringify(result)).byteLength > BROWSER_AGENT_LIMITS.encodedJsonBytes) {
      throw new AgentBrowserError('QUOTA_EXCEEDED', 'browser snapshot exceeds its JSON bound')
    }
    return { result, bindings: accepted.map(item => item.binding) }
  }

  private createRef(node: AxNode, index: number): AgentBrowserRef {
    const digest = createHash('sha256')
      .update(`${this.surfaceId}\0${this.surfaceGeneration}\0${this.revision}\0${node.nodeId}\0${node.backendDOMNodeId}\0${index}`)
      .digest('hex').slice(0, 32)
    return `browser:${digest}`
  }

  private currentBinding(ref: AgentBrowserRef): BrowserReferenceBinding {
    this.assertOpen()
    const binding = this.references.get(ref)
    if (binding === undefined || binding.revision !== this.revision || binding.epoch !== this.epoch) {
      throw new AgentBrowserError('STALE_REF', 'browser reference is stale')
    }
    return binding
  }

  private async boxCenter(
    binding: BrowserReferenceBinding,
    budget: OperationBudget,
    signal?: AbortSignal,
  ): Promise<{ readonly x: number; readonly y: number }> {
    const response = record(await this.command(
      'DOM.getBoxModel',
      { backendNodeId: binding.backendDOMNodeId },
      budget,
      signal,
    ))
    const model = record(response?.model)
    const content = model?.content
    if (!Array.isArray(content) || content.length !== 8 || content.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new AgentBrowserError('INTERNAL', 'browser target box is invalid')
    }
    const xValues = [content[0], content[2], content[4], content[6]] as number[]
    const yValues = [content[1], content[3], content[5], content[7]] as number[]
    return {
      x: xValues.reduce((total, value) => total + value, 0) / xValues.length,
      y: yValues.reduce((total, value) => total + value, 0) / yValues.length,
    }
  }

  private async revalidateBinding(
    binding: BrowserReferenceBinding,
    budget: OperationBudget,
    signal?: AbortSignal,
    requireFocused = false,
  ): Promise<BrowserReferenceBinding> {
    const liveNodes = await this.walkAccessibilityTree(budget, signal)
    const matches = liveNodes.nodes.filter(node => node.backendDOMNodeId === binding.backendDOMNodeId)
    if (matches.length !== 1) throw new AgentBrowserError('STALE_REF', 'browser target no longer has one live AX node')
    const live = matches[0]
    if (live === undefined) throw new AgentBrowserError('STALE_REF', 'browser target is stale')
    if (requireFocused) {
      const focusedBackendNodeIds = new Set(liveNodes.nodes.flatMap(node => (
        node.focused && node.backendDOMNodeId !== undefined ? [node.backendDOMNodeId] : []
      )))
      if (focusedBackendNodeIds.size !== 1 || !focusedBackendNodeIds.has(binding.backendDOMNodeId)) {
        throw new AgentBrowserError('STALE_REF', 'browser focus moved away from the referenced target')
      }
    }
    const editable = EDITABLE_ROLES.has(live.role)
    const selectable = SELECTABLE_ROLES.has(live.role)
    const targetAttributes = attributes(await this.command(
      'DOM.describeNode',
      { backendNodeId: binding.backendDOMNodeId, depth: 0, pierce: false },
      budget,
      signal,
    ))
    if (classifyBrowserTarget({
      role: live.role,
      name: live.name,
      editable,
      ...(typeof targetAttributes.type === 'string' ? { type: targetAttributes.type } : {}),
      ...(typeof targetAttributes.autocomplete === 'string' ? { autocomplete: targetAttributes.autocomplete } : {}),
      disabled: live.disabled || targetAttributes.disabled === true,
      readonly: live.readonly || targetAttributes.readonly === true,
    }) === 'DENY') {
      throw new AgentBrowserError('POLICY_DENIED', 'browser target is no longer safe to mutate')
    }
    if (live.nodeId !== binding.axNodeId || live.role !== binding.role || live.name !== binding.name
      || editable !== binding.editable || selectable !== binding.selectable) {
      throw new AgentBrowserError('STALE_REF', 'browser target semantics changed after snapshot')
    }
    return binding
  }

  private async click(binding: BrowserReferenceBinding, budget: OperationBudget, signal?: AbortSignal): Promise<void> {
    const point = await this.boxCenter(binding, budget, signal)
    await this.showAgentPointer(point.x, point.y, budget, signal)
    await this.command('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1,
    }, budget, signal)
    await this.command('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1,
    }, budget, signal)
  }

  private async pressKey(
    key: string,
    modifiers: readonly string[],
    budget: OperationBudget,
    signal?: AbortSignal,
  ): Promise<void> {
    const modifierMask = keyModifiers(modifiers)
    await this.command('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers: modifierMask }, budget, signal)
    await this.command('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers: modifierMask }, budget, signal)
  }

  private async scroll(
    binding: BrowserReferenceBinding | undefined,
    deltaX: number,
    deltaY: number,
    budget: OperationBudget,
    signal?: AbortSignal,
  ): Promise<void> {
    const viewport = this.checkedViewport()
    const point = binding === undefined
      ? { x: viewport.width / 2, y: viewport.height / 2 }
      : await this.boxCenter(binding, budget, signal)
    await this.showAgentPointer(point.x, point.y, budget, signal)
    await this.command('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: point.x, y: point.y, deltaX, deltaY,
    }, budget, signal)
  }

  private async showAgentPointer(
    x: number,
    y: number,
    budget: OperationBudget,
    signal?: AbortSignal,
  ): Promise<void> {
    const radius = 7
    await this.command('Overlay.highlightQuad', {
      quad: [
        x - radius, y - radius,
        x + radius, y - radius,
        x + radius, y + radius,
        x - radius, y + radius,
      ],
      color: { r: 45, g: 112, b: 255, a: 0.32 },
      outlineColor: { r: 45, g: 112, b: 255, a: 0.95 },
    }, budget, signal)
  }

  private async wait(
    action: Extract<AgentBrowserAction, { readonly kind: 'wait' }>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (action.mode === 'duration') {
      await this.delay(action.durationMs, signal)
      return
    }
    const events = ['did-navigate', 'did-navigate-in-page', 'did-stop-loading', 'did-fail-load']
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer)
        for (const event of events) this.webContents.removeListener(event, done)
        signal?.removeEventListener('abort', aborted)
      }
      const done: Listener = () => {
        if (this.webContents.isLoading()) return
        cleanup()
        resolve()
      }
      const aborted = (): void => {
        cleanup()
        reject(new AgentBrowserError('CANCELLED', 'browser wait was cancelled'))
      }
      const timer = setTimeout(() => {
        cleanup()
        resolve()
      }, BROWSER_AGENT_LIMITS.waitDurationMs)
      for (const event of events) this.webContents.on(event, done)
      signal?.addEventListener('abort', aborted, { once: true })
      done()
    })
  }

  private checkedViewport(): BrowserViewport {
    const viewport = this.viewport()
    if (![viewport.width, viewport.height, viewport.deviceScaleFactor]
      .every(value => Number.isFinite(value) && value > 0)) {
      throw new AgentBrowserError('INTERNAL', 'browser viewport is invalid')
    }
    return viewport
  }

  private async captureScreenshot(
    budget: OperationBudget,
    signal?: AbortSignal,
  ): Promise<{ readonly metadata: AgentBrowserImageMetadata; readonly png: Uint8Array }> {
    const viewport = this.checkedViewport()
    const physicalWidth = viewport.width * viewport.deviceScaleFactor
    const physicalHeight = viewport.height * viewport.deviceScaleFactor
    if (!Number.isFinite(physicalWidth) || !Number.isFinite(physicalHeight)) {
      throw new AgentBrowserError('INTERNAL', 'browser viewport is invalid')
    }
    let scale = Math.min(
      1,
      BROWSER_AGENT_LIMITS.screenshotEdge / physicalWidth,
      BROWSER_AGENT_LIMITS.screenshotEdge / physicalHeight,
      Math.sqrt(BROWSER_AGENT_LIMITS.screenshotPixels / (physicalWidth * physicalHeight)),
    )
    if (!Number.isFinite(scale) || scale <= 0) throw new AgentBrowserError('INTERNAL', 'browser screenshot scale is invalid')
    for (let attempt = 0; attempt < BROWSER_AGENT_LIMITS.screenshotAttempts; attempt += 1) {
      const response = await this.command('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        fromSurface: true,
        clip: { x: 0, y: 0, width: viewport.width, height: viewport.height, scale },
      }, budget, signal)
      const bytes = decodedPng(response)
      if (bytes === undefined) {
        if (attempt + 1 === BROWSER_AGENT_LIMITS.screenshotAttempts) {
          throw new AgentBrowserError('QUOTA_EXCEEDED', 'browser screenshot exceeds its image bound')
        }
        scale /= 2
        continue
      }
      const dimensions = pngDimensions(bytes)
      const expectedPhysicalWidth = Math.ceil(physicalWidth * scale)
      const expectedPhysicalHeight = Math.ceil(physicalHeight * scale)
      // Chromium versions differ on whether Page.captureScreenshot's clip
      // scale is applied before or after the backing-store device scale.
      // Both results describe the exact visible viewport; accept only these
      // two deterministic pairs, never an arbitrary image size.
      const expectedCssWidth = Math.ceil(viewport.width * scale)
      const expectedCssHeight = Math.ceil(viewport.height * scale)
      const oversized = bytes.byteLength > BROWSER_AGENT_LIMITS.pngBytes
        || dimensions.width > BROWSER_AGENT_LIMITS.screenshotEdge
        || dimensions.height > BROWSER_AGENT_LIMITS.screenshotEdge
        || dimensions.width * dimensions.height > BROWSER_AGENT_LIMITS.screenshotPixels
      const dimensionsMatch = dimensions.width === expectedPhysicalWidth
        && dimensions.height === expectedPhysicalHeight
        || dimensions.width === expectedCssWidth && dimensions.height === expectedCssHeight
      if (!oversized && !dimensionsMatch) {
        throw new AgentBrowserError('INTERNAL', 'browser screenshot dimensions do not match the declared scale')
      }
      if (oversized) {
        if (attempt + 1 === BROWSER_AGENT_LIMITS.screenshotAttempts) {
          throw new AgentBrowserError('QUOTA_EXCEEDED', 'browser screenshot exceeds its image bound')
        }
        scale /= 2
        continue
      }
      const transferId = this.createTransferId()
      if (!TRANSFER_ID.test(transferId)) throw new AgentBrowserError('INTERNAL', 'browser screenshot transfer id is invalid')
      const png = new Uint8Array(bytes)
      return {
        metadata: Object.freeze({
          transferId,
          byteLength: png.byteLength,
          sha256: createHash('sha256').update(png).digest('hex'),
          width: dimensions.width,
          height: dimensions.height,
        }),
        png,
      }
    }
    throw new AgentBrowserError('INTERNAL', 'browser screenshot capture did not complete')
  }

  private installListeners(): void {
    if (this.listenersInstalled) return
    this.listenersInstalled = true
    this.webContents.on('did-navigate', this.invalidateOnNavigation)
    this.webContents.on('did-navigate-in-page', this.invalidateOnNavigation)
    this.webContents.on('destroyed', this.markDestroyed)
    this.webContents.on('will-navigate', this.guardNavigation)
    this.webContents.on('will-redirect', this.guardRedirect)
    this.webContents.debugger.on('message', this.debuggerMessage)
    this.webContents.debugger.on('detach', this.debuggerDetached)
  }

  private removeListeners(): void {
    if (!this.listenersInstalled) return
    this.listenersInstalled = false
    this.webContents.removeListener('did-navigate', this.invalidateOnNavigation)
    this.webContents.removeListener('did-navigate-in-page', this.invalidateOnNavigation)
    this.webContents.removeListener('destroyed', this.markDestroyed)
    this.webContents.removeListener('will-navigate', this.guardNavigation)
    this.webContents.removeListener('will-redirect', this.guardRedirect)
    this.webContents.debugger.removeListener('message', this.debuggerMessage)
    this.webContents.debugger.removeListener('detach', this.debuggerDetached)
  }

  private async followValidatedNavigation(value: string): Promise<void> {
    try {
      const target = await this.urlPolicy.authorize(value)
      if (this.stopped || this.destroyed || this.webContents.isDestroyed()) return
      this.invalidate()
      await this.loadAuthorized(target)
    } catch {
      // A page-directed navigation that cannot be verified remains cancelled.
    }
  }

  private async loadAuthorized(
    target: string,
    signal?: AbortSignal,
    commit: () => void | Promise<unknown> = async () => await this.webContents.loadURL(target),
  ): Promise<void> {
    if (new URL(target).protocol !== 'https:') {
      throw new AgentBrowserError('POLICY_DENIED', 'browser navigation requires HTTPS')
    }
    this.approvedNavigation = target
    try {
      const hostname = new URL(target).hostname.replace(/^\[|\]$/gu, '')
      if (isIP(hostname) !== 0) {
        await commit()
      } else {
        const transport = this.pinnedNavigationTransport
        if (transport === undefined) {
          throw new AgentBrowserError('POLICY_DENIED', 'browser hostname navigation requires a pinned transport')
        }
        const navigationState = { committed: false, targetValidated: false, transportReturned: false }
        try {
          await transport.load({
            url: target,
            ...(signal === undefined ? {} : { signal }),
            resolveAndValidate: async (value, requestSignal) => {
              const resolved = await this.urlPolicy.resolveForConnect(value, requestSignal ?? signal)
              if (resolved.url === target) navigationState.targetValidated = true
              return resolved
            },
            commit: async () => {
              if (navigationState.transportReturned || navigationState.committed
                || !navigationState.targetValidated) {
                throw new AgentBrowserError('POLICY_DENIED', 'browser pinned navigation commit is not authorized')
              }
              navigationState.committed = true
              await commit()
            },
          })
        } finally {
          navigationState.transportReturned = true
        }
        if (!navigationState.committed) {
          throw new AgentBrowserError('INTERNAL', 'browser pinned transport did not commit navigation')
        }
      }
    } catch (error) {
      if (error instanceof AgentBrowserError) throw error
      throw new AgentBrowserError('INTERNAL', 'browser navigation failed')
    } finally {
      if (this.approvedNavigation === target) this.approvedNavigation = undefined
    }
  }

  private captureHistorySnapshot(offset: -1 | 1): BrowserHistorySnapshot {
    try {
      const history = this.webContents.navigationHistory
      const activeIndex = history.getActiveIndex()
      const targetIndex = activeIndex + offset
      const sourceUrl = this.webContents.getURL()
      const activeEntry = Number.isSafeInteger(activeIndex) ? history.getEntryAtIndex(activeIndex) : undefined
      const targetEntry = Number.isSafeInteger(targetIndex) ? history.getEntryAtIndex(targetIndex) : undefined
      if (!this.validHistoryEntry(activeEntry) || !this.validHistoryEntry(targetEntry)
        || activeEntry.url !== sourceUrl) {
        throw new AgentBrowserError('INTERNAL', 'browser history target is unavailable')
      }
      return Object.freeze({
        activeIndex,
        targetIndex,
        sourceUrl,
        activeEntry: Object.freeze({ ...activeEntry }),
        targetEntry: Object.freeze({ ...targetEntry }),
      })
    } catch (error) {
      if (error instanceof AgentBrowserError) throw error
      throw new AgentBrowserError('INTERNAL', 'browser history target is unavailable')
    }
  }

  private assertHistorySnapshot(snapshot: BrowserHistorySnapshot, revision: number, offset: -1 | 1): void {
    this.assertOpen()
    try {
      const history = this.webContents.navigationHistory
      const activeEntry = history.getEntryAtIndex(snapshot.activeIndex)
      const targetEntry = history.getEntryAtIndex(snapshot.targetIndex)
      const allowed = offset === -1 ? history.canGoBack() : history.canGoForward()
      if (this.revision !== revision || !allowed || history.getActiveIndex() !== snapshot.activeIndex
        || this.webContents.getURL() !== snapshot.sourceUrl
        || !this.sameHistoryEntry(activeEntry, snapshot.activeEntry)
        || !this.sameHistoryEntry(targetEntry, snapshot.targetEntry)) {
        throw new AgentBrowserError('STALE_REF', 'browser history changed before navigation commit')
      }
    } catch (error) {
      if (error instanceof AgentBrowserError) throw error
      throw new AgentBrowserError('STALE_REF', 'browser history changed before navigation commit')
    }
  }

  private assertReloadState(sourceUrl: string, revision: number): void {
    this.assertOpen()
    if (this.revision !== revision || this.webContents.getURL() !== sourceUrl) {
      throw new AgentBrowserError('STALE_REF', 'browser page changed before reload commit')
    }
  }

  private validHistoryEntry(value: unknown): value is Readonly<{ url: string; title?: string; pageState?: string }> {
    const source = record(value)
    return typeof source?.url === 'string' && source.url.length > 0
      && (source.title === undefined || typeof source.title === 'string')
      && (source.pageState === undefined || typeof source.pageState === 'string')
  }

  private sameHistoryEntry(
    value: unknown,
    expected: Readonly<{ url: string; title?: string; pageState?: string }>,
  ): boolean {
    return this.validHistoryEntry(value) && value.url === expected.url
      && value.title === expected.title && value.pageState === expected.pageState
  }

  private prevent(event: unknown): void {
    if (hasPreventDefault(event)) event.preventDefault()
  }

  private invalidate(kind: 'hard' | 'material' = 'hard'): void {
    if (kind === 'hard') this.hardEpoch += 1
    this.epoch += 1
    this.revision += 1
    this.references.clear()
  }

  private assertOpen(): void {
    if (this.destroyed || this.webContents.isDestroyed()) {
      throw new AgentBrowserError('TARGET_CLOSED', 'browser surface is closed')
    }
    if (this.stopped) throw new AgentBrowserError('TARGET_CLOSED', 'browser adapter is stopped')
  }

  private assertEpoch(epoch: number): void {
    this.assertOpen()
    if (this.epoch !== epoch) throw new AgentBrowserError('STALE_REF', 'browser surface changed during the operation')
  }

  private assertSignal(signal?: AbortSignal): void {
    if (signal?.aborted === true) throw new AgentBrowserError('CANCELLED', 'browser operation was cancelled')
  }
}
