# Agent Note: Packaged client module proxy transparency

Status: implemented

English | [中文](2026-08-31-packaged-client-module-proxy-transparency.zh.md)

## Problem

Electron packages the application module tree inside `app.asar`, while an external Harness profile cannot traverse a filesystem symlink into that archive. App boot therefore exposes application packages through managed ESM proxies. The client module scanner previously stopped at each proxy manifest. Those manifests intentionally describe Node re-exports rather than browser clients, so the scanner found no `dsh.client` declarations, published an empty boot graph, and started the Desktop shell without its client plugins.

## Decision

The client module scanner treats an app-boot managed ESM fallback proxy as one transparent package-location step. A proxy must use the generated private ESM manifest, an `entry-N.js` default export, and a `file:` target in `dsh.moduleFallback.targets`. The scanner follows that target once, requires the original manifest to declare the same package name, and reads `dsh.client`, `./client`, and bundle bytes from the original package. Invalid targets, loops, and a second proxy fail closed. Node host imports continue to use the proxy.

## Alternatives considered

**Copy `dsh.client` into every proxy manifest.** The proxy's exported file is a Node ESM re-export, not the authored browser bundle. Concatenating it into a browser combo would replace an empty graph with invalid browser code.

**Unpack the complete application module tree.** This would avoid archive traversal but substantially enlarge the unpacked application surface and duplicate files solely for profile resolution.

## Consequences

Packaged Desktop startup publishes the same bootstrap and application client batches as a source installation while retaining the external profile proxy required for Node resolution. The scanner now depends on the exact app-boot proxy marker and one original `file:` target; other packages and arbitrary proxy-like manifests keep their existing resolution behavior.
