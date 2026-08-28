# Native Computer Use helper

English | [中文](README.zh.md)

This Rust workspace builds the private, on-demand helper used by the Desktop main process for native Computer Use protocol work. It is not a network service: Electron owns one child over length-prefixed stdin/stdout and starts no child while the capability is idle.

## Contract

The `protocol` crate strictly decodes the shared [`protocol-v1.json`](../../packages/control/desktop-control-protocol/protocol-v1.json), rejects duplicate or unknown fields, applies declared frame limits before body allocation, and correlates raw PNG frames by transfer ID, byte length, SHA-256, and dimensions. The checked-in TypeScript fixtures must round-trip byte for byte.

The `core` crate owns monotonic lease expiry, exact session/lease/revision/target checks, and quotas. `status`, `list`, `snapshot`, `stop`, `lease.install`, revocation controls, and `input.release` are the only implemented dispatch paths. The packaged null observation platform reports unsupported/empty status and returns `NOT_SUPPORTED` for snapshots. Focus, pointer, keyboard, text, scroll, and wait requests always return `NOT_SUPPORTED`; this workspace does not call TCC, Accessibility, ScreenCaptureKit, CGEvent, SendInput, AppleScript, or PowerShell APIs.

The `helper` crate owns the bounded stdio loop. Malformed input closes only the dedicated link without echoing input or OS diagnostics. EOF is the normal shutdown signal.

## Development

The toolchain is pinned by `rust-toolchain.toml`, and dependencies are pinned by `Cargo.lock`.

```sh
cd native/computer-use-helper
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

[`scripts/build-computer-use-helper.ts`](../../scripts/build-computer-use-helper.ts) builds one release target and independently validates its executable header before placing it under `apps/desktop/native-bin/<platform>-x64/`. Desktop staging revalidates that exactly one matching helper exists; Electron Builder copies it outside ASAR as `resources/native/computer-use-helper[.exe]`.
