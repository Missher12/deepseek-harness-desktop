# DeepSeek Harness 桌面版实施记录

[English](2026-08-13-deepseek-harness-desktop.md) | 中文

**日期：** 2026-08-13

**状态：** 已实现；Intel macOS 在线迁移已验证；Windows 原生产物验证待完成

## 目标

将官方 DeepSeek Harness Web 界面转换为自包含的 Intel macOS 应用，提供类似 Codex 的专注窗口、随机回环端口、原生生命周期和圆角白鲸图标。

## 阶段 1：基线与安全

- 固定官方仓库基线，并保留 upstream remote。
- 只读检查已安装 Web 运行时、数据根目录、进程树和固定端口所有权。
- 在隔离的 `codex/deepseek-desktop-app` 分支和 worktree 中工作。
- 所有自动化测试和成品测试均使用临时 `DSH_HOME`。
- 在用户明确批准迁移之前，保留 Hermes 所拥有的 65000 端口进程。

## 阶段 2：原生外壳

- 添加 `apps/desktop`，使用 Electron 43.4.0，并且只打包 x86_64。
- 实现单实例行为、原生菜单、加载与失败页面、窗口状态持久化和安全的外部导航。
- 禁用渲染器 Node 集成；启用上下文隔离、沙箱和 Web 安全。
- 通过 preload 只暴露 3 个经过校验的桌面命令和 3 个经过校验的恢复动作。
- 在 `127.0.0.1` 上以端口 `0` 启动内置 CLI，只接受它输出并经过校验的回环地址，然后等待就绪。
- 只跟踪并停止准确的受控进程组。

## 阶段 3：桌面界面

- 复用官方 React/Vite 应用和 WebSocket 传输。
- 添加明确的桌面界面查询参数与 body 标记。
- 保留会话、对话和详情栏，同时减少仅适用于浏览器的界面元素。
- 将原生的新建会话、命令搜索和设置动作连接到稳定的渲染器 hook。
- 保持已经验收的 1254×1254 RGBA 白鲸图标母版原样，并从同一母版生成 macOS `.icns` 与 Windows `.ico`。

## 阶段 4：自包含打包

- 添加确定性的暂存步骤：部署桌面依赖图、复制已构建的应用文件，并校验必需的原生二进制文件。
- 包含 CLI、bundle 和动态挂载客户端插件所需的完整 workspace 依赖闭包。
- 将沙箱 preload 输出为 CommonJS `preload.cjs`。
- 将运行时 `node_modules` 保存在 `app.asar.unpacked` 下，并把 Harness profile fallback 软链接重定向到这些实体包。
- 在没有 Node 内部 ESM loader 时允许仅配置 HMR，同时保留模块 HMR 对内部 loader 的要求。
- 构建未签名的本地 `.app` 与 Intel DMG，Bundle ID 为 `ai.deepseek.harness.desktop`。

## 阶段 5：验证

运行聚焦回归测试：

```sh
pnpm exec vitest run apps/desktop/tests scripts/stage-desktop.spec.ts packages/boot/app-boot/tests/profile.spec.ts packages/boot/app-boot/tests/user-patches.spec.ts --config vitest.config.ts
```

运行静态检查与依赖检查：

```sh
pnpm run build
pnpm run lint
pnpm run verify-runtime-closure
pnpm run doc-sync
```

构建并校验产物：

```sh
pnpm run desktop:pack
pnpm run desktop:dmg
hdiutil verify apps/desktop/release/DeepSeek-Harness-0.1.0-mac-x64.dmg
```

成品 smoke 必须从仓库外的临时目录启动，并验证 preload bridge、随机回环监听、三栏外壳、稳定的插件图、设置对话框、原生退出、后代进程清理和监听端口清理。

## 已交付文件

- `apps/desktop/`：Electron 源码、静态渲染页面、图标资源、打包配置和桌面测试。
- `scripts/stage-desktop.ts`：自包含暂存与校验。
- `packages/boot/app-boot/src/profile.ts`：指向实体 asar-unpacked 包的 fallback 目标。
- `vendor/hmr/src/index.ts`：成品 Node 的仅配置 HMR 兼容处理。
- 现有 Web 客户端包：桌面标记、界面适配和原生命令 hook。
- `PROJECT_CONTEXT.md`：项目状态、架构、安全边界和发布证据。

## 在线迁移结果

Intel macOS 应用现在已经接管真实的 `~/.dsh` 运行时。准确的旧进程组已优雅退出，65000 端口已经释放，独立的 Hermes 网关保持运行；已安装应用在随机回环端口上通过 HTTP、窗口、Dock、Finder 图标和实体包链接检查。权限受限的迁移前备份仍然保留，过程中没有迁移数据，也没有复制凭据。
