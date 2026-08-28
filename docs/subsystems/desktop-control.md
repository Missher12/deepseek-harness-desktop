# Desktop Control

English | [中文](desktop-control.zh.md)

Desktop Control defines the Host-side service seams used by later adapters for the visible Agent browser and user-authorized native applications. It does not provide Electron, browser-debugger, native-helper, UI, or model-tool implementations.

Sources:

- [`packages/control/desktop-control-protocol`](../../packages/control/desktop-control-protocol)
- [`packages/control/browser-control`](../../packages/control/browser-control)
- [`packages/control/computer-control`](../../packages/control/computer-control)

## Protocol ownership

`@deepseek-ai/dsh-desktop-control-protocol` is the sole owner of every cross-process request, result, error, and branded identifier. The Browser and Computer Service Definitions import or re-export those types; their own types contain only same-process ownership and validation facts.

The closed protocol exposes no JavaScript, selector, command, generic payload, or raw operating-system escape. Optional PNG metadata is limited to transfer identity, byte length, lower-case SHA-256, width, and height. The PNG bytes travel in the protocol's separate bounded binary envelope.

## Browser service seam

`ctx.browserControl` captures a bounded semantic snapshot, executes one of the ten closed browser actions, and revokes all browser ownership for one session. Provider-held opaque references bind the official session id to a surface id, surface generation, and snapshot revision. A foreign session is rejected before freshness is disclosed.

The browser service owns no coordinate action. Page text and accessibility semantics remain untrusted and cannot grant approval or prove that hostile page JavaScript lacks external side effects.

## Computer service seam

`ctx.computerControl` reports platform support, lists grantable applications and windows, captures a bounded native snapshot, executes one of the eight closed native actions, and stops native control for one session. Provider-held opaque references bind session, application, process id and creation identity, window, snapshot revision, and display scale.

The pure policy returns only `ALLOW`, `APPROVAL_REQUIRED`, or `DENY`. Unknown runtime facts fail closed. Known secure fields and privileged or destructive target classes are denied; external effects and persistent human-browser mutations require a separate native approval. A matching-surface Stop remains approval-free so revocation cannot be blocked by a target classification.

## Bounded immutable results

Both service packages accept only primitive runtime fields, reconstruct protocol results from their closed fields, and return detached deeply frozen objects. Semantic collections and text use protocol-owned limits. PNG metadata is rebuilt from exactly five validated fields, so provider-local objects or additional fields cannot cross the service boundary.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowsercontrol--browsercontrol-abstract-seam"></a>

### `ctx.browserControl` — `BrowserControl` (abstract seam)

Abstract semantic browser-control seam. A single Service Provider owns the visible surface, current reference registry, session revocation, and all browser-side cleanup.

```ts cordis-catalog
/**
 * Capture bounded semantics and an optional image for the current browser surface.
 * @param request - Strict protocol request received from the Desktop bridge.
 * @param signal - Caller lifetime.
 * @returns an immutable bounded protocol snapshot.
 */
abstract snapshot(request: BrowserSnapshotRequest, signal: AbortSignal): Promise<BrowserSnapshot>

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
 * @returns an immutable bounded protocol snapshot.
 */
abstract snapshot(request: ComputerSnapshotRequest, signal: AbortSignal): Promise<ComputerSnapshot>

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
