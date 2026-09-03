# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Unofficial desktop distribution

This community repository preserves the official source and adds an unofficial Intel macOS and Windows x64 desktop application under [`apps/desktop`](apps/desktop/README.md). It is not an official DeepSeek desktop release. The application embeds the existing Harness Web runtime in a native Electron window, owns a random loopback port, and ships the user-supplied whale icon.

Download the DMG or Setup executable from this repository's [Releases](https://github.com/Missher12/deepseek-harness-desktop/releases). The current builds are unsigned; macOS may require **Open** from Finder's context menu on first launch, and Windows may show a SmartScreen prompt.

Desktop 0.5.2 builds the Intel macOS DMG and Windows x64 Setup from the same tested Harness `0.1.1-rc.2` source revision. It restores the v0.4.11 PromptRail, gives the existing Project/Session tree a clearer ChatGPT-like rhythm, keeps Review, Terminal, Browser, and Files in a fixed resizable Workbench, and adds a risk-confirmed **Don't ask again this session** action for the existing Full access preset. Startup phases are measured without skipping validation, while Windows packaging removes only unreachable platform assets and uses dedicated taskbar, tray, and installer icons. Exact legacy 0.4.x fallback migration, bounded local document attachments, and Memory & Learning remain intact. Windows remains installer-updated; the in-app updater is currently available only for Intel macOS.

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
