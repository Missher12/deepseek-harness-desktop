# DeepSeek Harness Desktop

English | [中文](README.zh.md)

DeepSeek Harness Desktop brings the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) to macOS, Windows and Ubuntu. It is an independent community desktop distribution maintained by Missher.

The project has two goals: package official Harness releases as desktop applications, and keep existing user-developed plugins fully usable on those applications.

[Download](https://github.com/Missher12/deepseek-harness-desktop/releases) · [Desktop guide](apps/desktop/README.md) · [Plugins](#plugins) · [Source migration](docs/desktop-source-migration.md)

## Downloads and development status

The published release is [Desktop 0.5.8](https://github.com/Missher12/deepseek-harness-desktop/releases/tag/desktop-v0.5.8), built with Harness 0.1.5-rc.2. Use its release notes and checksums for the delivered feature set and installation details.

| Platform | Target | Installer |
| --- | --- | --- |
| macOS | Intel x64 | DMG |
| Windows | x64 | Setup EXE |
| Ubuntu | 22.04 / 24.04 x64 | deb / AppImage |

The main branch contains Desktop 0.6.0 development source migrated from the validation repository. Its base-and-plugin separation is still in progress. The migration does not publish new installers or establish completed platform acceptance; the [migration record](docs/desktop-source-migration.md) identifies the imported source and outstanding checks.

## Desktop and plugin responsibilities

Desktop owns native windows, runtime startup and shutdown, system integration, installation and system updates. Official Harness provides the standard chat, model, tool and session capabilities. The three desktop targets share the same product structure.

Starting with Desktop **0.6.0**, the desktop and plugins will be maintained and upgraded separately. The standard distribution will include **Enhance** as an independent enhancement plugin. Other plugins will be downloaded and installed from their own GitHub repositories.

Enhance remains independently configurable, disableable and upgradeable even when included by default. Compatible plugins can retain their versions when Desktop updates; a plugin receives only the compatibility changes needed to keep its existing functions available.

<a id="plugins"></a>

## Plugins

| Component | Existing capabilities | Project or availability |
| --- | --- | --- |
| Enhance | Usage statistics, highlighted footer, piano navigation, projectless sessions, model helpers, personalization, documents and cross-session messaging | `dsh-missher-enhance`; included in the planned 0.6.0 standard distribution, packaging in progress |
| Project Ops | Project task discovery, execution, collection and verification | [dsh-project-ops](https://github.com/Missher12/dsh-project-ops) |
| Memory | Reviewed facts, capture, search and memory maintenance | [dsh-missher-memory](https://github.com/Missher12/dsh-missher-memory) |
| MSE / Evolution | Harness integration for the existing MSE experience and rule system | [dsh-missher-evolution](https://github.com/Missher12/dsh-missher-evolution) |
| Media@Missher | Setup, collection, run results and export through the existing Media runtime | `dsh-media-missher`; private/local distribution |
| Brain | Shared recall coordination for Memory and MSE, with data retained by each provider | `dsh-missher-brain`; local candidate, public installation entry pending |

Plugin repositories and their Releases are the download entry points for additional plugins; unpublished entries are marked pending, and private repositories require access. Each plugin owns its supported Harness versions and platform limits. A project link alone does not establish compatibility with the current Desktop candidate. Media and MSE retain their original cores; this repository does not contain their private working data.

## Plugin settings and marketplace

The intended common entry is **Settings → Plugins**, with **Installed** and **Marketplace** views. Installed plugins need visible versions, supported Harness versions, enabled or paused status, and configuration or usage entries. The existing marketplace should supply discovery, installation and updates, with results reflected in the installed list.

Completing this path is the first outstanding integration task. Statistics, model helpers and other features retain their natural settings or conversation entries. The removed right Workbench and its BrowserSkill/Open Design entries are excluded. Feishu is outside the maintained plugin scope.

## Update policy

For each official release, prepare the shared desktop and its macOS, Windows and Ubuntu packages first, then check the existing plugins against that version. Apply small plugin compatibility changes where needed. Confirmed incompatibility can pause a plugin while preserving its installation and data; temporary network or API failures do not by themselves prove incompatibility.

A paused or unverified plugin remains an outstanding item. Package creation and passing configuration checks do not mean every plugin is fully usable. Platform acceptance and release publication follow the [release guide](apps/desktop/releasing/README.md).

<a id="run"></a>

<a id="run-from-source"></a>

## Development

Start with the [Desktop guide](apps/desktop/README.md), [development guide](docs/development.md) and [architecture](docs/architecture.md). Direct CLI usage belongs to the [official-profile reference](apps/cli/reference/README.md). Contributors and agents follow [AGENTS.md](AGENTS.md) and the current [project context](PROJECT_CONTEXT.md).

Desktop issues belong in [this repository](https://github.com/Missher12/deepseek-harness-desktop/issues); plugin issues belong in their owning projects. Official Harness development remains with the [upstream project](https://github.com/deepseek-ai/deepseek-harness).

## License

[MIT](LICENSE). Preserve upstream notices; dependency notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
