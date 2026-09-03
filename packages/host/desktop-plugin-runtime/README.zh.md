# `@deepseek-ai/dsh-host-desktop-plugin-runtime`

[English](README.md) | 中文

这个私有 Host 包为 DeepSeek Harness Desktop 中受信任的插件管理器发布两个结构化服务：不可变的 `desktopProfiles.current` 身份，以及串行化的 `desktopPnpm.runPlugin()` 包操作。

它只由 Desktop 应用的私有 patch 挂载，普通 Web profile 不会获得这些服务。包操作会重新进入内置 `dsh plugin` 命令，因此 profile 初始化、相对调用目录的路径锚定与 `dsh.profile.bundles` 对账仍由上游 CLI 负责。

服务不通过 PATH 查找，而是解析内置 pnpm JavaScript 入口；它会拒绝不安全参数与调用目录，通过受管 subprocess 服务运行，并在清理时取消完整操作进程树。subprocess 边界提供去除凭据的环境；这里只显式增加当前 `DSH_HOME`、内置 pnpm 入口、Electron Node 模式与非交互标记。

## 模型体验

无。该包只管理 Host 侧插件包，不会组装或发送模型请求。

#### KV Cache 影响

无；包管理操作不会改变提供方请求载荷或缓存。

### Invariant ownership

不发布不变式伴生入口，因为插件运行时所有权由桌面 profile 测试覆盖。

## 已知限制与延期工作

- **单一固定 profile**：当前 Desktop shell 在一个 generation 内只公开当前 `web` profile，尚不实现 profile 切换。
- **受信任管理器策略边界**：包目标策略仍由受信任管理器负责；内置 Desktop 组合使用精选的 `dshmarket` 路由，不提供通用 renderer bridge。
