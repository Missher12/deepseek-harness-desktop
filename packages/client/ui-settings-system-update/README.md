# @deepseek-ai/dsh-client-ui-settings-system-update

English | [中文](README.zh.md)

This Desktop-only client package contributes the System Update section to Settings. It renders the narrow `window.dshDesktop` update state and invokes only fixed check, download, and install operations owned by the Electron main process.

The package never selects a repository, network URL, destination path, checksum, or executable command. Official Harness tags are informational; only a validated Intel macOS Desktop release manifest can enable download and installation.

## Model Experience

None, as this package only presents update state and invokes fixed Electron-owned operations. It does not assemble prompts, select models, or send provider requests.

#### KV Cache effect

None; the package never participates in a model request or changes its cache behavior.

### Invariant ownership

No invariant companion is published because each component validates every Remote state before rendering.

## Known Limitations and Deferred Work

- **Intel macOS Desktop only** — the section is hidden when the verified Electron preload bridge is absent, including ordinary browsers and the current Windows Desktop build.
- **Fixed release channel** — users cannot select a repository, mirror, asset, checksum, destination, or installer command from this package.
- **Unsigned artifacts** — code signing and notarization remain release-infrastructure work; the Electron main process still requires an exact manifest, SHA-256 match, and compatible x86_64 bundle before installation.
