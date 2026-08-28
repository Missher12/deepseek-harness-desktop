# Desktop Control

English | [中文](desktop-control.zh.md)

Desktop Control defines the Host-side service seams and dedicated owned-child IPC providers used by later adapters for the visible Agent browser and user-authorized native applications. It does not yet provide lease authority, browser-debugger, native-helper, UI, or model-tool implementations.

Sources:

- [`packages/control/desktop-control-protocol`](../../packages/control/desktop-control-protocol)
- [`packages/control/browser-control`](../../packages/control/browser-control)
- [`packages/control/computer-control`](../../packages/control/computer-control)
- [`packages/control/desktop-control-host`](../../packages/control/desktop-control-host)

## Protocol ownership

`@deepseek-ai/dsh-desktop-control-protocol` is the sole owner of every cross-process request, result, error, and branded identifier. Its 27-kind bridge roster includes internal-only acquire/release requests. Acquire preserves each app/window relationship, accepts only the closed surface and capability rosters, and returns only an effective relative-duration descriptor; helper install reuses those targets and adds Electron-owned total and category quotas. The Browser and Computer Service Definitions import or re-export those types; their own types contain only same-process ownership and validation facts.

The closed protocol exposes no JavaScript, selector, command, generic payload, or raw operating-system escape. Optional PNG metadata is limited to transfer identity, byte length, lower-case SHA-256, width, and height. The PNG bytes travel in the protocol's separate bounded binary envelope. A transport-owned JSON validator runs before screenshot correlation, so a valid message from the wrong direction fails immediately without opening pending PNG state.

Encoding rejects custom prototypes, `toJSON`, accessors, non-enumerable or symbol-keyed state, and shared or cyclic values before serialization, then strictly validates the exact emitted JSON frame. A direction validator receives only that detached JSON, must not return data, and permanently closes its decoder if it rejects or returns anything.

## Owned-child Host bridge

The Desktop-only `@deepseek-ai/dsh-desktop-control-host` plugin registers both service providers only when the Harness process has the exact Node IPC channel created by Electron. One process-wide client, lease cache, 32-entry pending ledger, 256-entry FIFO terminal tombstone set, and callback-driven envelope queue serve both providers. The Electron peer owns a separate ledger and queue. Every frame is copied and unprefixed on this Node channel; JSON and its optional verified PNG remain adjacent, and neither peer advances from the non-authoritative boolean return of `send()`.

Harness-to-Electron accepts all 27 bridge requests plus only request cancellation and session revocation. Electron-to-Harness accepts matching responses plus only their immediately adjacent PNG, lease revocation, and parent shutdown. Both directions validate before image correlation, bind work to the exact child generation, require ID/kind/session and optional lease tuple matches, and close only the control link on malformed, wrong-direction, mismatched, or failed transport.

Normal turn stopping synchronously invalidates the cached lease and awaits a bounded release with an independent cleanup signal. The post-commit `turn/end` listener is deliberately fire-and-forget and only queues a fallback; the awaited session flush drains that tail. Session disposal queues session revocation, and plugin/application teardown drains cleanup before disconnecting the exact IPC link and terminating the owned process tree. Until the later Electron authority is installed, requests fail closed with `NOT_SUPPORTED`; ordinary Harness startup and chat do not depend on this channel.

## Browser service seam

`ctx.browserControl` first exposes internal `acquireLease(request, signal)` to trusted Consumers, then captures a bounded semantic snapshot, executes one of the ten closed browser actions, and revokes all browser ownership for one session. Provider-held opaque references bind the official session id to a surface id, surface generation, and snapshot revision. A foreign session is rejected before freshness is disclosed.

The browser service owns no coordinate action. Page text and accessibility semantics remain untrusted and cannot grant approval or prove that hostile page JavaScript lacks external side effects.

## Computer service seam

`ctx.computerControl` exposes the same protocol-owned internal lease acquisition, reports platform support, lists grantable applications and windows, captures a bounded native snapshot, executes one of the eight closed native actions, and stops native control for one session. Provider-held opaque references bind session, application, process id and creation identity, window, snapshot revision, and display scale.

Neither acquire operation is a model tool. Later tool Consumers derive official session and transport fields; their model schemas never expose acquire, lease authority, approval, quotas, clocks, or action digests.

The generated documentation retains both service contracts for trusted first-party implementers. The model-facing runtime Cordis catalog and live inspection exclude them, however, and the dynamic package façade withholds both property and `ctx.get()` access even when a package declares injection. This leaves ordinary static first-party Cordis providers and Consumers unchanged while preventing model-authored packages from acquiring Desktop-control authority.

The pure policy returns only `ALLOW`, `APPROVAL_REQUIRED`, or `DENY`. Unknown runtime facts fail closed. Known secure fields and privileged or destructive target classes are denied; external effects and persistent human-browser mutations require a separate native approval. A matching-surface Stop remains approval-free so revocation cannot be blocked by a target classification.

## Bounded immutable results

Both service packages accept only primitive runtime fields, reconstruct protocol results from their closed fields, and return detached deeply frozen objects. Semantic collections and text use protocol-owned limits. PNG metadata is rebuilt from exactly five validated fields, so provider-local objects or additional fields cannot cross the service boundary. Each snapshot service returns an exact local envelope containing the protocol result and, only when metadata declares an image, a copied protocol `ImmutablePng`; no raw byte-array field crosses the service seam.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowsercontrol--browsercontrol-abstract-seam"></a>

### `ctx.browserControl` — `BrowserControl` (abstract seam)

Abstract semantic browser-control seam. A single Service Provider owns the visible surface, current reference registry, session revocation, and all browser-side cleanup.

```ts cordis-catalog
/**
 * Ask Electron main to authorize and mint one browser control lease.
 * This is an internal trusted-provider operation and never a model tool.
 * @param request - Protocol-owned request with official session and transport fields.
 * @param signal - Caller lifetime.
 * @returns the effective Electron-authored lease descriptor.
 */
abstract acquireLease( request: ControlLeaseAcquireRequest, signal: AbortSignal, ): Promise<ControlLeaseAcquireResult>

/**
 * Capture bounded semantics and an optional image for the current browser surface.
 * @param request - Strict protocol request received from the Desktop bridge.
 * @param signal - Caller lifetime.
 * @returns an immutable service envelope whose result and PNG owner remain paired.
 */
abstract snapshot(request: BrowserSnapshotRequest, signal: AbortSignal): Promise<BrowserSnapshotEnvelope>

/**
 * Execute one action from the closed browser request roster.
 * @param request - Strict protocol action DTO.
 * @param signal - Caller lifetime.
 * @returns the protocol result associated with the action family.
 */
abstract act(request: BrowserActionRequest, signal: AbortSignal): Promise<BrowserActionResult>

/**
 * Revoke a session's browser ownership and await complete surface cleanup.
 * @param sessionId - Official Harness session identity to revoke.
 */
abstract revokeSession(sessionId: SessionId): Promise<void>
```

Types: [SessionId](core.md)

Source: [`packages/control/browser-control/src/index.ts`](../../packages/control/browser-control/src/index.ts)

<a id="ctxcomputercontrol--computercontrol-abstract-seam"></a>

### `ctx.computerControl` — `ComputerControl` (abstract seam)

Abstract native Computer Control seam. A single Service Provider owns authorization, app/window identity, reference freshness, stop, and native resource cleanup.

```ts cordis-catalog
/**
 * Ask Electron main to authorize and mint one native-application control lease.
 * This is an internal trusted-provider operation and never a model tool.
 * @param request - Protocol-owned request with official session and transport fields.
 * @param signal - Caller lifetime.
 * @returns the effective Electron-authored lease descriptor.
 */
abstract acquireLease( request: ControlLeaseAcquireRequest, signal: AbortSignal, ): Promise<ControlLeaseAcquireResult>

/**
 * Read the bounded local platform support and permission snapshot.
 * @returns current platform support and permission states.
 */
abstract status(): Promise<ComputerControlStatus>

/**
 * List only applications and windows eligible for an explicit user grant.
 * @param request - Strict protocol list request.
 * @param signal - Caller lifetime.
 * @returns an immutable bounded protocol collection.
 */
abstract list(request: ComputerListRequest, signal: AbortSignal): Promise<ComputerListResult>

/**
 * Capture bounded semantics and an optional image for one authorized window.
 * @param request - Strict target-scoped protocol request.
 * @param signal - Caller lifetime.
 * @returns an immutable service envelope whose result and PNG owner remain paired.
 */
abstract snapshot(request: ComputerSnapshotRequest, signal: AbortSignal): Promise<ComputerSnapshotEnvelope>

/**
 * Execute one action from the closed native request roster.
 * @param request - Strict target-scoped protocol action DTO.
 * @param signal - Caller lifetime.
 * @returns the protocol result associated with the action family.
 */
abstract act(request: ComputerActionRequest, signal: AbortSignal): Promise<ComputerActionResult>

/**
 * Stop a session's native control and await release of its native resources.
 * @param sessionId - Official Harness session identity to stop.
 */
abstract stop(sessionId: SessionId): Promise<void>
```

Types: [SessionId](core.md)

Source: [`packages/control/computer-control/src/index.ts`](../../packages/control/computer-control/src/index.ts)
<!-- END GENERATED cordis-surface -->
