# Desktop System Update Settings

[中文](README.zh.md)

This Desktop-only client package contributes the System Update section to Settings. It renders the narrow `window.dshDesktop` update state and invokes only fixed check, download, and install operations owned by the Electron main process.

The package never selects a repository, network URL, destination path, checksum, or executable command. Official Harness tags are informational; only a validated Intel macOS Desktop release manifest can enable download and installation.

## Model Experience

None, as this browser-side Desktop update section registers no model tool, prompt text, provider request, or conversation event.

#### KV Cache effect

Checking, downloading, or installing a Desktop update does not alter model context or provider request prefixes.

## Known Limitations and Deferred Work

- Updates require a newer compatible Intel macOS Desktop manifest with a matching DMG size and SHA-256; official Harness source tags alone cannot be installed.
- The local unsigned build may require Finder's **Open** action on first launch. Signing and notarization require external Apple credentials.
- Download and installation remain explicit user actions. The package does not perform silent background replacement or cross-platform updates.
