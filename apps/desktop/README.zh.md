# DeepSeek Harness 桌面版

[English](README.md) | 中文

Desktop 0.6.0 通过根目录的 `desktop:stage` 命令准备官方 Harness 基础组合。应用在操作系统分配的随机端口上管理一个仅限回环地址的 Harness 子进程，并在加固后的 Electron 窗口中运行官方 Web 客户端。这个源码版本不代表公开发布或三端验收通过。

发布收集与公开步骤遵循[平台发布指南](releasing/README.zh.md)。

<a id="composition-scope"></a>
## 组合范围

基础组合保留完整的官方 Web 依赖图，只追加[原生窗口控制与关闭行为](../../packages/client/ui-desktop-shell/README.zh.md)和[系统更新](../../packages/client/ui-settings-system-update/README.zh.md)。它从规范 `web` 派生受管 `desktop-base` profile，保留规范配置、已安装插件源码和产品数据。仅在规范 profile 缺失时通过官方 Web 模板初始化。计费、统计、个性化与模型辅助由可选插件提供。已删除的工作台及其原生浏览器接口保持排除。

准备流程将固定在 `fb2c4b9e698e30edb738bca4cf0618587db7d203` 的干净官方源码、Harness `0.1.5-rc.2` 和全部 275 个 tarball 身份绑定到可信描述文件 SHA-256。已安装 runtime 的身份另行绑定输入描述文件、物理文件库存和本机操作系统／架构。版本字符串相同或从其他操作系统复制 runtime 都不能满足这些检查。[可复现输入决策](../../.agents/notes/implemented/architecture/2026-09-13-reproducible-desktop-base-inputs.zh.md)统一说明来源、安装和审计规则。

<a id="prepare-the-base-stage"></a>
## 准备基础 stage

在原生 Intel macOS、Windows x64 或 Linux x64 上，从仓库根目录执行，并预先安装当前 checkout 的依赖。提供干净官方源码、经过独立审阅的 tarball 描述文件及其可信 SHA-256。以下 shell 示例中的路径需要替换为自己拥有的输入位置：

```bash
pnpm run desktop:stage \
  --official-source /path/to/official-source \
  --packages /path/to/official-packages \
  --descriptor /path/to/official-inputs.json \
  --descriptor-sha256 '<trusted-descriptor-sha256>' \
  --runtime /path/to/local-official-runtime
```

Windows 使用相同参数、原生路径，以及单行命令或 PowerShell 续行语法。[`prepare-desktop-base.ts`](../../scripts/prepare-desktop-base.ts) 无 shell 地选择固定的 `pnpm@11.7.0` JavaScript 执行器，验证或准备本机 runtime，准备独立更新 helper runtime，构建原生客户端与主进程，再装配 stage。这些说明定义当前准备入口，不代表安装器流程已经验收完成。

已有 runtime 的本机安装回执匹配时，流程只读验证它。经过审计的 S2 runtime 额外使用成对参数 `--runtime-audit /path/to/runtime-audit.json --runtime-audit-sha256 <trusted-audit-sha256>`。外置审计将官方输入描述文件、runtime 库存、当前平台／架构和带 hash 的原生证据绑定在一起。导入不会向不可变 runtime 安装、改写内容或添加回执。回执缺失或不匹配会失败，不会静默重建已验收核心。

helper 是独立的 Node `24.17.0` 可执行文件。`--helper-runtime /path/to/helper-runtime` 选择已准备目录；`--helper-cache /path/to/download-cache` 选择固定版本下载缓存。已有 helper 只读验证。正式准备要求回执记录真实的本机 `--version` 探测；解压其他平台归档或注入测试探测不能满足这一要求。

默认输出为 `apps/desktop/.stage`。`--stage /path/to/dsh-desktop-stage` 选择新的 stage 目录。准备流程拒绝并保留已有 stage；可对它执行打包命令，或另选输出位置。stage 包含 `base-smoke.json`、基础组合描述文件、官方 runtime 和单独标识的原生适配器。成品中的 `official-runtime`、基础 patch 和组合描述文件在 `app.asar.unpacked` 下保持为物理文件，使 profile 解析能够创建真实文件系统链接；独立 helper 复制到 `desktop-helper` 资源目录。

`--build-official` 显式运行固定官方源码的正式构建及 tarball 打包命令。它要求新的包集和描述文件输出位置，再让结果通过同一套验证。仅在明确要求重新构建官方核心时使用；已验收核心应复用经过审阅的输入回执。例如：

```bash
pnpm run desktop:stage --build-official \
  --official-source /path/to/clean-official-source \
  --packages /path/to/new-official-packages \
  --descriptor /path/to/new-official-inputs.json \
  --runtime /path/to/new-local-runtime \
  --stage /path/to/new/dsh-desktop-stage
```

使用默认 `.stage` 时，准备完成后执行对应原生平台的包脚本：Intel macOS 使用 `pnpm --filter @deepseek-ai/dsh-desktop run pack:dir` 或 `pack:dmg`，Windows x64 使用 `pack:setup`，Linux x64 使用 `pack:linux`。自定义 `--stage` 也要求打包命令选择同一目录。不得用 full 依赖或增强清单替换这个 base stage。`desktop:full:stage:built` 是显式的历史 full 暂存入口；没有组合描述文件的已安装 full 应用保留既有启动选择。

Windows 的 `pack:win-dir` 与 `pack:setup` 共用 [Windows 打包入口](../../scripts/windows-desktop-builder.ts)。它在原 stage 配置旁保留 `electron-builder.windows-derived.json`，并将该文件排除在安装包之外。已有派生文件会被保留并导致调用拒绝；再次调用需要新准备的 stage。[打包决策](../../.agents/notes/implemented/architecture/2026-09-13-reproducible-desktop-base-inputs.zh.md#packaged-file-selection-and-permissions)说明文件过滤与已安装描述文件的权限。

## 插件兼容与恢复

通用设置中的**插件兼容与恢复**会打开独立原生窗口；启动失败页也能进入同一控制页及系统更新，不依赖失败的 Web 插件图。更改需要原生重启确认，当前生成和工具任务将停止。规范 `web` 始终是 CLI 插件安装目标。Desktop 仅管理同一 Harness home 下的派生 `desktop-base` profile 和 `.desktop-compatibility` 状态；不删除原 Session 代际、配置、插件源码或数据。

用户启用选择与兼容健康状态相互独立。可归因的 Bundle YAML 加载失败需要不同观察记录才会自动暂停；`DSH_DESKTOP_PLUGIN_FAILURE_CONFIRMATIONS` 显式配置原生确认阈值，范围为 1 至 64，默认为 2。持久阈值不匹配时，需要关闭 Desktop 后修正配置。网络、鉴权、限流、超时、取消和不明核心故障不会导致 Bundle 暂停。恢复先检查当前安装包并实际启动候选 Host，之后才能消费进程内验证回执；用户原有手动停用选择保持不变。

派生 profile 使用 `startup` 补丁加载策略并记录规范配置的原偏好。相对插入插件名通过官方加载器锚定到原补丁路径。不安全的动态引用、冲突的 root 或 preset 引用、损坏的全局输入及非本应用拥有的派生目录会进入原生恢复状态，不会静默丢弃用户配置。包管理命令继续使用 `--profile web`；不支持直接编辑 `desktop-base`。[Profile 恢复决策](../../.agents/notes/implemented/architecture/2026-09-13-desktop-profile-recovery.zh.md)说明范围和验证限制。

## Linux 与验证边界

Linux `.deb` 将 `python3` 声明为依赖之一。更新能力仍需通过原生能力预检。AppImage 缺少能力不能授权自动替换；已验证安装包与手动安装行为仍由[原生更新实现](src/update/)约束。准备好 helper 或 stage 不代表 Linux 更新或安装已经通过验收。

## 插件入口

从 0.6.0 开始，标准发行方案为基础 Desktop 配套独立的 Enhance 增强插件，其他插件从各自 GitHub 项目获取。基础 stage 继续保持最小组合；默认插件配套属于独立的交付任务，本次源码迁移不代表它已经完成。

当前接入目标是“设置 → 插件”，提供已安装列表和原有插件市场。每个已安装的用户插件都必须显示版本、兼容状态及配置或使用入口。统计与模型辅助保留原有功能入口。该路径仍在完善中，组件归属见[插件清单](../../README.zh.md#plugins)。

## 已发布安装包与源码状态

通过 [Releases](https://github.com/Missher12/deepseek-harness-desktop/releases) 获取已验收安装包。迁入的开发源码版本为 Desktop 0.6.0，已发布版本为 0.5.8。复制源码、生成 stage 或通过隔离样例，不等于完成安装或更新。[迁移记录](../../docs/desktop-source-migration.zh.md) 区分这些状态。

<a id="icon-provenance"></a>
## 图标来源

应用和托盘资源维护在 [assets](assets/) 中。保留已有来源声明和仓库[许可证](../../LICENSE)。

## 开发备注

验证源码与平台工作流已迁入主仓库，本次没有发布新安装包。已有 Windows、Ubuntu 原生失败仍待解决，迁移本身不会重跑或认证这些检查。旧的完整组合说明保留在 Git 历史中，不作为基础产品的定义。
