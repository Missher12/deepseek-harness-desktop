# Agent Note: Semantic browser adapter ownership and safety bounds

Status: implemented

English | [中文](2026-08-28-semantic-browser-adapter-ownership.zh.md)

## Problem

Model-directed browser control needs useful page semantics without turning Electron's renderer, debugger, signed-in browser state, or network access into general authority. A browser page is untrusted, while debugger attachment, navigation, accessibility-tree mutation, and destruction can race every asynchronous observation and input operation.

The human Workbench browser already owns a persistent signed-in partition. Reusing that partition implicitly for Agent work would mix session ownership and credentials; creating independent Agent views without a process-wide owner would instead allow concurrent sessions to reveal, hide, or mutate one another's browser.

Semantic trees and screenshots are also attacker-influenced data. Unbounded traversal, arbitrary CDP, editable values, private-network destinations, native file choosers, downloads, permissions, or full-page captures would expand both the information and action surface beyond the fixed Browser Control contract.

## Decision

The Desktop browser layer separates global surface ownership, page policy, and the closed CDP adapter into [`surface-manager.ts`](../../../../apps/desktop/src/browser/surface-manager.ts), [`policy.ts`](../../../../apps/desktop/src/browser/policy.ts), and [`cdp-adapter.ts`](../../../../apps/desktop/src/browser/cdp-adapter.ts). [`contracts.ts`](../../../../apps/desktop/src/browser/contracts.ts) owns the action validator, opaque ref shape, partition names, snapshot envelope, structured failures, and fixed resource bounds. These files export narrow Electron-facing interfaces and do not register a model tool or alter main, preload, or renderer composition.

## Ownership and lifecycle

One `BrowserSurfaceManager` instance owns the process-wide Agent browser slot. Its acquire input carries the official session derived by the trusted provider. The first call atomically reserves that session, consumes only a coordinator-verified persistent Give intent for the exact `persist:dsh-workbench-browser` instance, or creates and visibly mounts a uniquely named non-persistent surface before returning. An active surface is reusable only with its exact session and generation; another session receives `BUSY` without consuming another intent or calling mount, hide, or teardown on the owner.

Every mount has a generation and mount token. Stale hide and Stop tokens are harmless, and cleanup failures retain the owner in a fail-closed state rather than admitting a replacement. Stop attempts generation-owned handler disposal, debugger detach, view teardown, ephemeral storage clearing, and coordinator revocation in order, awaits every step even after one fails, and clears ownership only after the sequence reaches quiescence. A mount that fails before publication follows the same rule: all cleanup steps run, failed steps remain attached to the unpublished session and generation, every acquire stays `BUSY`, and only an exact lifecycle retry may release the slot after those failed steps succeed. A transferred human-persistent surface is never cleared; an ephemeral Agent partition is always distinct from the Workbench partition.

The surface resource installs popup, navigation, download, and permission guards before mount. The guards deny every new window, cancel downloads, and make both permission-check and permission-request paths reject every permission, including camera, microphone, location, and clipboard access. A long-lived main-process handler owner installs Electron's single-slot window-open and permission dispatchers once, retains the preexisting human handlers as its base layer, and adds or removes Agent generations without setting those slots to `null`; stale disposal cannot remove a newer generation or the human behavior underneath it. Existing event listeners are likewise left in place while the generation removes only its own navigation and download listeners. The adapter enables `Page.setInterceptFileChooserDialog` on every owned debugger attachment, disables it before detaching that owned debugger, and exposes no file-setting operation.

## CDP and reference boundary

`CdpBrowserAdapter` first rejects an already attached or attach-race-winning foreign debugger with `BUSY`; it records `attachedByUs` only after its own successful attachment and detaches only in that state. Main-document navigation, same-document navigation, surface destruction, debugger detach, `Accessibility.nodesUpdated`, and `DOM.documentUpdated` advance the adapter epoch and revision, clear all refs, and make every late CDP completion fail its post-await epoch check.

The CDP roster is closed to `Accessibility.getRootAXNode`, bounded breadth-first `Accessibility.getChildAXNodes`, read-only `DOM.describeNode`, `DOM.getBoxModel`, the fixed `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, and `Input.insertText` methods, visible-viewport `Page.captureScreenshot`, and file-chooser interception. `DOM.describeNode` contributes only `type`, `autocomplete`, `disabled`, and `readonly`. No `Runtime` method, JavaScript evaluation, selector, arbitrary CDP dispatch, remote-debugging port, coordinate action, or file-setting path is exposed.

Traversal stops at 2,000 raw nodes, depth 32, 512 CDP calls, or 2,000 ms. Projection retains at most 300 actionable refs, 49,152 UTF-8 semantic bytes, and a 65,536-byte encoded JSON result. Refs bind the surface generation, adapter revision, AX identity, backend DOM identity, and registry position. Snapshots omit editable values, and policy rejects password, one-time-code, payment, file, upload, disabled, readonly, and uncertain editable targets before a ref enters the registry. Immediately before every ref-based mutation, the adapter performs another bounded AX read and `DOM.describeNode`, reclassifies the live role, name, editability, type, autocomplete, disabled, and readonly facts, and rejects a sensitive target or any changed AX identity/semantics before issuing an `Input` command.

The action validator accepts only navigate, ref-based click and type, bounded key chords, ref-based select, bounded viewport or ref-based scroll, bounded duration/navigation/loading-idle waits, history movement, reload, and Stop at the surrounding lifecycle. Browser input computes an internal box center only after resolving a current ref; no caller can supply a selector or coordinate.

## Network and screenshot policy

`AgentBrowserUrlPolicy` accepts only HTTP(S) URLs without userinfo. It has no Node DNS fallback: composition must adapt `resolveHost()` from the exact Electron `Session` that owns the surface. It validates literal and resolved destinations, including IPv4-mapped IPv6, and rejects loopback, link-local, private, carrier-grade NAT, site-local, unspecified, multicast, malformed resolver output, and reserved localhost names unless the user-owned allowlist explicitly admits that exact destination. The adapter cancels page-directed navigation and every redirect before independently authorizing the next hop; page text cannot alter the allowlist.

A preflight DNS answer followed by ordinary `loadURL()` is not a rebinding defense because Chromium may resolve again before connection. Public IP literals retain direct loading after policy validation. Hostnames instead require a surface-owned pinned-navigation transport. The injected Task 8 transport contract receives a request-time `resolveAndValidate` capability and must apply it to every initial, redirected, and subresource CONNECT, connect the socket only to one returned public address, and retain the original URL hostname for HTTP Host, HTTPS SNI, and certificate verification. Without that transport, hostname navigation fails closed and never falls back to `loadURL`; this Task 7 layer does not silently approximate pinning with `webRequest` or URL-to-IP rewriting.

Screenshots cover only the visible viewport with `captureBeyondViewport: false`. Before capture, the adapter deterministically chooses a scale no greater than one so the expected output has no edge above 2,048 pixels and no area above 4,194,304 pixels. Oversized encodings reduce scale geometrically for at most three total attempts without allocating an unbounded decoded buffer. A delivered image passes canonical base64 decoding, PNG signature and IHDR checks, exact scaled dimensions, the 4,194,304-byte and pixel bounds, UUID transfer-ID validation, and SHA-256 calculation before metadata and detached PNG bytes enter the pair-preserving snapshot envelope.

## Verification

[`browser-agent.spec.ts`](../../../../apps/desktop/tests/browser-agent.spec.ts), [`browser-policy.spec.ts`](../../../../apps/desktop/tests/browser-policy.spec.ts), and [`browser-contracts.spec.ts`](../../../../apps/desktop/tests/browser-contracts.spec.ts) run with fake debugger, WebContents, Session, and surface resources. The focused suite pins attachment ownership and races, late replies and ref invalidation, every bound, snapshot-to-action sensitivity changes, the CDP and action rosters, screenshot reduction and validation, public-to-private DNS rebinding without load or connect, stable human handler restoration, atomic session ownership, stale tokens, persistent transfer, failed-mount reservation and lifecycle retry, and revocation. The three specs pass 63 tests; the Desktop package passes `tsc --noEmit`, and scoped repository oxlint passes for the implementation and tests.

## Alternatives considered

**Attach opportunistically and always detach during Stop.** This would let Agent cleanup disconnect a debugger owned by a developer or another subsystem. Ownership is explicit and detach is conditional on `attachedByUs`.

**Use `Runtime`, JavaScript evaluation, or selectors for richer interaction.** These mechanisms create a general page execution and extraction channel whose authority cannot be described by the fixed Browser Control action roster. Accessibility semantics and opaque refs deliberately trade reach for a reviewable closed boundary.

**Reuse the signed-in Workbench partition for every Agent session.** Automatic reuse would expose human cookies and storage without a verified transfer and would make session isolation ambiguous. Agent work receives a unique non-persistent partition unless the coordinator consumes an explicit Give intent for the visible persistent instance.

**Capture full pages or expose screenshot coordinates as a fallback.** Full-page captures have page-controlled geometry, and coordinate fallback would turn image observation into unconstrained pointer authority. The adapter keeps viewport capture bounded and browser actions semantic.

**Release global ownership after a failed cleanup attempt.** Admitting a replacement while debugger, view, storage, or revocation state is uncertain could create two effective owners. Cleanup attempts every step but retains the failed generation as busy until the process owner resolves the failure.

**Resolve a hostname once and then call `loadURL()`, or rewrite HTTPS URLs to the chosen IP.** The former leaves a DNS rebinding window between validation and Chromium's connection; the latter changes SNI and certificate identity. Hostnames therefore require the injected address-pinning transport, and remain unavailable until Task 8 supplies it.

## Consequences

The browser adapter has a small, auditable authority boundary: one trusted session owns one visible surface; every page-derived ref expires on material change; every input is drawn from a fixed roster; and network, permission, file, traversal, JSON, and image limits fail closed. The human Workbench browser keeps its persistent partition and behavior unless the coordinator verifies an explicit transfer.

The same boundary intentionally gives up arbitrary web automation. Pages whose useful controls lack accessible semantics, fields whose sensitivity cannot be established, private destinations without an explicit allowlist, popups, downloads, uploads, and permission-dependent workflows are unsupported. Hostname navigation also remains deliberately unavailable until Task 8 injects a controlled CONNECT transport satisfying the pinning contract; there is no insecure fallback. Real Electron composition supplies that transport, the manager resource, and authority coordinator through the narrow interfaces; this layer itself does not change ordinary CLI or Web startup and does not expose Browser Control through UI or tools.
