# @deepseek-ai/dsh-tool-browser-control

English | [中文](README.zh.md)

`dsh-tool-browser-control` exposes the Desktop-owned semantic browser surface as twelve closed first-party tools. The package is a Consumer of [`dsh-browser-control`](../browser-control/README.md), not a browser backend: it registers nothing unless `ctx.browserControl` exists, so ordinary CLI and Web compositions remain unchanged.

## Tools and contract

- `browser_snapshot` returns the current URL, title, revision, bounded semantic text, and opaque refs. When the exact active route declares image input and `ctx.attachments` accepts PNG, it requests a provider-validated `ImmutablePng`, commits a fresh byte copy with `attachments.saveImage()`, and renders the durable reference as an `ImageBlock`. PNG bytes are never encoded into text.
- `browser_navigate` accepts only an absolute destination URL. URL and redirect policy remains authoritative in Electron.
- `browser_click`, `browser_type`, and `browser_select` accept only an opaque current `ref` plus their ordinary action value. `browser_scroll` accepts bounded integer deltas and optionally a current `ref`; it has no coordinate form.
- `browser_key` accepts only a key and the closed `Alt` / `Control` / `Meta` / `Shift` modifier vocabulary. The frozen protocol has no key target ref.
- `browser_wait` accepts only `duration`, `navigation`, or `loading-idle`; duration is the only mode that accepts `duration_ms`, bounded to 0–10,000 ms.
- `browser_back`, `browser_forward`, and `browser_reload` accept no arguments.
- `browser_stop` accepts no arguments, acquires no lease, requests no approval, and awaits `revokeSession()` cleanup for the official calling session.

Every parameter root has `additionalProperties: false`. No tool accepts selectors, coordinates, files, uploads, chooser handles, session or lease metadata, `approved`, grants, action digests, or another authority-looking field. The Consumer derives the official session from the live Agent, mints request IDs and deadlines, and reuses one provider-authored lease promise only within that turn. Turn stop/end, session disposal, provider disposal, revocation, and expiry forget cached lease state.

Known password, OTP, payment, file, upload, and other protected-target refusals arrive from the authoritative BrowserControl provider as policy results. The tools map those failures to a redacted refusal and never render the protected ref or provider diagnostic. Persistent human-surface one-shot native challenges are likewise provider/Electron policy; `ctx.approval` UX and model arguments are not authorization.

While the provider exists, the package contributes an official-browser-only prompt section. Any BrowserControl failure also activates a monotonic per-session, per-turn execution guard: `bash`, `pwsh`, `run_code`, `terminal_open`, and `terminal_send` are denied. A successful official browser snapshot or action clears a recoverable transport, lease, ownership, or internal failure; an authorization, policy, permission, unsupported, quota, or binary failure remains closed until the turn ends. A successful awaited `browser_stop` explicitly clears that session's guard after cleanup, while a failed Stop leaves it closed. Stop and one official retry remain available where recovery is valid, so the model cannot turn a failed BrowserControl call into a direct DevTools, remote-debugging-port, script, or shell fallback through the normal tool pipeline.

## Model Experience

### Tool schemas

#### What the model sees

The model sees the twelve closed [Browser Control tool schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-browser-control) and the official-browser-only recovery instructions only while Desktop supplies `BrowserControl`. It first calls `browser_snapshot`, uses only current opaque refs for semantic target actions, and snapshots again after navigation or a stale-ref result. Snapshot text is bounded and a visual route receives one adjacent durable image block without gaining coordinate actions. Pending presentation omits typed text and protected page content.

#### Token effect

The fixed schemas and short recovery section add a bounded input cost whenever the Desktop provider is mounted. Snapshot semantics and optional image references are per-call results, so their data-dependent size does not become standing prompt text.

#### KV Cache effect

The roster is prefix-stable while `BrowserControl` availability and the closed schemas remain unchanged. Provider-absent deployments add no schemas or prompt text; mounting or removing the provider changes tool visibility and may invalidate reuse from that point.

## Known Limitations and Deferred Work

- Accessibility semantics cannot classify every sensitive target or prove the outcome of ordinary page JavaScript. A normal click, key, selection, scroll, or navigation may still cause an external effect; provider policy and visible user control remain the authority.
- `browser_key` and condition waits are page-level protocol operations and therefore have no element ref. The package does not invent one outside the frozen shared DTO.
- Image-capability discovery or attachment storage absence falls back to semantic text. It never exposes uncommitted bytes or a data URL.
- This package does not own the Browser surface, CDP, SSRF/redirect checks, downloads, popups, permissions, file-chooser suppression, native approval challenge, toolbar, or emergency-stop UI.
- The direct-fallback guard governs model tool execution after an official failure; it is not isolation from a malicious trusted Host plugin or an unrelated external process.
