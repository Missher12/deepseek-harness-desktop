# DeepSeek Harness Desktop

English | [中文](README.zh.md)

DeepSeek Harness Desktop is an independent community distribution of the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), maintained by Missher. It packages the official application for macOS, Windows and Ubuntu.

The source baseline is **Harness 0.1.6-alpha.2**. Desktop and its bundled Harness use the same version. The three platforms share the official interface, the blue-purple whale icon and an operating-system-assigned loopback port.

<a id="run"></a>

## Downloads

Download installers and their SHA-256 checksums from [GitHub Releases](https://github.com/Missher12/deepseek-harness-desktop/releases). A source branch does not establish that its installers have been published; each release lists the available files and validation results.

| Platform | Architecture | Installer |
| --- | --- | --- |
| macOS | Intel x64 | DMG |
| Windows | x64 | Setup EXE |
| Ubuntu | 22.04 / 24.04 x64 | deb / AppImage |

These community packages carry their own runtime. macOS packages use local ad-hoc signatures and are not notarized; Windows packages are unsigned. Platform installation requirements and native validation results belong to the release notes.

## Application and plugins

The application retains the official chat, model settings, sessions and Plugin Manager. This distribution does not preinstall the Missher enhancement package or other personal plugins.

Install optional plugins through the official **Plugins** page. Each plugin is responsible for declaring its supported Harness version. The presence of a GitHub repository or an installable package does not establish compatibility.

<a id="run-from-source"></a>

## Source and packaging

The upstream baseline is [dsh-v0.1.6-alpha.2](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.6-alpha.2). Community packaging lives in [desktop-packaging](desktop-packaging/); the official Electron shell lives in [apps/desktop](apps/desktop/README.md).

Platform packages are built from one integrated source commit. Their checks cover installation, application readiness and exit with isolated data. They do not use paid model calls or establish third-party plugin compatibility.

For source development, see the [development guide](docs/development.md), [architecture](docs/architecture.md) and [contribution guide](CONTRIBUTING.md). Report issues with this distribution in [this repository](https://github.com/Missher12/deepseek-harness-desktop/issues).

## License

[MIT](LICENSE). Upstream Harness is developed by DeepSeek AI. Dependency licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
