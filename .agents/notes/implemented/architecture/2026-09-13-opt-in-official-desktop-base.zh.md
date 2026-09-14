# Agent Note: 基于独立构建官方运行时的可选 Desktop 基础组合

Status: implemented

[English](2026-09-13-opt-in-official-desktop-base.md) | 中文

## 问题

Desktop 增强组合与官方 Harness 运行时可能使用相同版本字符串，却包含不同源码、软件包和客户端行为。禁用可见增强项不能证明官方运行时来源，也不能移除其可执行依赖。基础候选组合还需要明确的选择规则，防止静默替换已有 Desktop 组合或迁移用户数据。

## 决策

[组合解析器](../../../../apps/desktop/src/harness/composition.ts) 仅在已安装的 `desktop-composition.json` 声明受支持的 schema、kind、官方源码和 Harness 版本时选择 `base`。文件缺失时选择 `full`；基础输入格式错误、不兼容或缺失时启动失败。基础组合使用独立的 `desktop-base` profile，并在该 profile 缺失时从官方 `web` 模板初始化。已有 profile 和产品数据不进行自动迁移。

官方输入锁定源码 `fb2c4b9e698e30edb738bca4cf0618587db7d203` 与 Harness `0.1.5-rc.2`。S2 隔离构建凭据记录干净源码树和 275 个软件包 tarball；独立安装的运行时作为基础输入。[运行时清单](../../../../scripts/desktop-base-runtime.ts) 记录实体文件大小、SHA-256 和内部符号链接目标。源码来源由隔离构建所有者确认；哈希清单本身不能认证源码来源。

[基础暂存器](../../../../scripts/stage-desktop-base.ts) 校验完整输入清单，将其复制到新暂存目录，并在追加外壳自有代码前校验副本。已有输出目录会被拒绝。[基础 patch](../../../../apps/desktop/base.cordis.patch.yml) 仅添加原生外壳和系统更新客户端；完整官方 Web 依赖图继续保留。这两个适配器是单独标识的追加内容，不修改官方软件包字节。

暂存目录写入 `official-runtime/desktop-native.json`，声明两个适配器的解析依赖。[原生主进程](../../../../apps/desktop/src/main.ts) 从已安装的官方运行时解析 `dsh-app-boot`，并以该清单为安装锚点调用其 `healProfilesModuleFallback`。此路径使用官方解析 API，不导入完整组合的缓存辅助函数，也不修改官方软件包清单。原生主进程还使用原子写入与 home 路径工具的官方原样副本。

[原生外壳客户端](../../../../packages/client/ui-desktop-shell/README.zh.md) 提供窗口呈现、有界菜单适配以及唯一的 `closeBehavior` 偏好；独立的[系统更新客户端](../../../../packages/client/ui-settings-system-update/README.zh.md) 保留原生更新操作。客户端集成使用官方 Cordis `Context`、Slots、本地化与 `InjectFace` 类型。Desktop 的价格、统计、个性化、模型策略和工作台增强均不属于 `base`。

## 考虑过的替代方案

**在派生 Web 客户端中隐藏增强功能。** 拒绝，因为可见性不能证明可执行内容来自官方。独立运行时使源码身份与追加的原生代码可以分别审查。

**裁剪官方 UI 软件包以缩小外壳。** 拒绝，因为官方功能可能在客户端就绪前依赖这些包。基础组合保留官方 Web 图，并将定制限制为两个追加客户端。

**默认选择基础组合或重新解释已有 profile。** 拒绝，因为两者都会在没有明确选择时改变已安装组合。描述文件显式启用保留 `full`，并将已有 profile 与数据迁移排除在 S2 范围外。

## 结果与影响

官方源码、运行时清单和外壳追加内容分别拥有明确的所有者与凭据。清单校验会在装配前拒绝缺失、变更、额外增加或越出目录的运行时文件。已安装组合解析器验证描述文件身份、版本和路径包含关系，不在每次启动时重新哈希整个运行时。重新构建官方输入或修改适配器后，需要新的装配证据。

S2 提供显式启用的基础实现，以及描述文件选择、运行时完整性、暂存、原生客户端行为和卸载清理的针对性检查。这些检查不代表安装器、公开发布或 Mac/Windows/Linux 原生验收通过。真实菜单目标和窗口几何布局仍须在 Electron 内运行装配后的官方客户端验证；安装器或发布结论需要各自绑定的产物与原生证据。

[按平台区分更新的决策](2026-09-09-platform-specific-desktop-updates.zh.md)与[启动就绪决策](2026-08-18-overlapped-desktop-startup.zh.md)继续保留各自独立的所有权与验证要求。本可选组合不替代其生命周期或安装保证。
