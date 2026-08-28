# Native Computer Use helper

English | [中文](README.zh.md)

This Rust workspace builds the private, on-demand helper used by the Desktop main process for native Computer Use protocol work. It is not a network service: Electron owns one child over length-prefixed stdin/stdout and starts no child while the capability is idle.

## Contract

The `protocol` crate strictly decodes the shared [`protocol-v1.json`](../../packages/control/desktop-control-protocol/protocol-v1.json), rejects duplicate or unknown fields, applies declared frame limits before body allocation, and correlates raw PNG frames by transfer ID, byte length, SHA-256, and dimensions. The checked-in TypeScript fixtures must round-trip byte for byte.

The `core` crate owns monotonic lease expiry, exact session/lease/revision/target checks, quotas, and the platform-neutral bounded accessibility projection. That projection is breadth-first and stops at depth 32, 2,000 raw nodes, 300 refs, 49,152 semantic-text bytes, 128 role bytes, and 1,024 name bytes. It skips hidden, minimized, and off-window nodes. Its platform seam has no editable-value field.

On macOS 14 and newer, the packaged helper implements bounded observation and a closed input roster. `status` uses prompt-free Screen Recording and Accessibility preflights. Authorized `list` results bind SCK window numbers to PID, kernel process-start time, and bundle identity. `snapshot` uniquely rebinds that exact SCK window to its AX window, reads only role, title/description, geometry, visibility, minimization, and children, and revalidates the process and window before returning. It never requests the AX value attribute. Optional screenshots use only an exact desktop-independent `SCContentFilter`, bounded `SCStreamConfiguration`, and `SCScreenshotManager`; images are at most 2,048 pixels per edge, 4,194,304 pixels, and 4 MiB, with at most three downscale attempts. A public read-only `CGMainDisplayID` lookup establishes the CoreGraphics display connection required by SCK in the CLI helper; it is neither a capture fallback nor a permission request. JSON and adjacent PNG frames retain the existing protocol-v1 correlation.

After a fresh snapshot, focus, semantic pointer actions, closed key events, bounded text, scroll, and wait requests revalidate the exact target, ref, permissions, cancellation, deadline, capability, and quota before every native event. CoreGraphics input is limited to that closed roster. Held keys and buttons are journaled only after successful delivery and are released on Stop, revoke, EOF, or recovery. Permission denial returns `PERMISSION_DENIED`; the Electron mapping supplies manual System Settings destinations and never requests or mutates TCC access. Unsupported platforms retain the null backend.

The `helper` crate owns the bounded stdio loop. Malformed input closes only the dedicated link without echoing input or OS diagnostics. EOF is the normal shutdown signal.

The macOS build gives the nested helper the fixed code identifier `ai.deepseek.harness.desktop.computer-use-helper`, and Electron Builder signs it as an explicit binary with the same identity as the app. A stable signing certificate is still required for a durable TCC designated requirement: ad-hoc signatures remain bound to the exact CDHash. Official distribution therefore requires Developer ID signing and notarization; replacing an older hash-identified local helper can require one final manual permission refresh.

## Development

The toolchain is pinned by `rust-toolchain.toml`, and dependencies are pinned by `Cargo.lock`.

```sh
cd native/computer-use-helper
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

[`scripts/build-computer-use-helper.ts`](../../scripts/build-computer-use-helper.ts) builds one release target and independently validates its executable header before placing it under `apps/desktop/native-bin/<platform>-x64/`. Desktop staging revalidates that exactly one matching helper exists; Electron Builder copies it outside ASAR as `resources/native/computer-use-helper[.exe]` and includes the macOS helper in its nested-binary signing pass.
