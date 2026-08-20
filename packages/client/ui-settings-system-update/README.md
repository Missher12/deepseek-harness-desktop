# Desktop System Update Settings

[中文](README.zh.md)

This Desktop-only client package contributes the System Update section to Settings. It renders the narrow `window.dshDesktop` update state and invokes only fixed check, download, and install operations owned by the Electron main process.

The package never selects a repository, network URL, destination path, checksum, or executable command. Official Harness tags are informational; only a validated Intel macOS Desktop release manifest can enable download and installation.
