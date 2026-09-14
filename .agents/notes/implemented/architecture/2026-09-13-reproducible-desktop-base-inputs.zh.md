# Agent Note: Desktop 基础组合的可复现官方输入

Status: implemented

[English](2026-09-13-reproducible-desktop-base-inputs.md) | 中文

## 问题

Desktop 安装包需要独立确认的官方源码字节、针对原生宿主安装的 runtime，以及单独拥有的桌面外壳扩展。Harness 版本字符串无法区分官方构建与修改后的 checkout。由本机一次性命令拼装的输入目录，也无法为后续维护者提供可复现准备入口或安全复用已验收 runtime 字节的规则。

## 决策

Desktop 0.6.0 使用 [`prepare-desktop-base.ts`](../../../../scripts/prepare-desktop-base.ts) 作为根目录 `desktop:stage` 入口。默认准备路径产出官方基础组合。这项准备决策替代[初始基础组合决策](2026-09-13-opt-in-official-desktop-base.zh.md)中的可选构建定位；它不会重新解释已安装且没有描述文件的 full 应用，也不会迁移已有 profile。Full 源码仍通过显式的 `desktop:full:stage:built` 历史入口保留。

[输入验证器](../../../../scripts/desktop-official-inputs.ts)要求干净的官方提交 `fb2c4b9e698e30edb738bca4cf0618587db7d203`、Harness `0.1.5-rc.2`，以及恰好列出 275 个 tarball 的描述文件的可信 SHA-256。每个归档都必须匹配记录的 hash、大小和实际包 manifest；重复身份、归档链接和越界路径会验证失败。tar 的普通和详细列表均接受 LF 或 CRLF 行结束，仅移除最后一个行结束符；成员名空白及转义控制字符保留给已有路径与类型检查。历史绝对包路径不能决定当前包目录。同版本 fork 包不能替换记录中的字节。

runtime 保留官方依赖构建策略，并对已验证包集使用本地文件 override。实际包 manifest 和官方 lockfile 中的 production 可达性证明被移除的 `@yao-pkg/pkg@6.21.0` 补丁仅用于开发依赖；`node-pty` 补丁仍然保留。`strictDepBuilds`、hoisted 安装和禁止自动安装 peer 依赖保持显式配置。已有 subprocess-local postinstall 只获得准确且经过审阅的 tarball 身份授权，不获得一般性的构建脚本放行。

## 来源身份与本机安装身份

源码与输入身份是可跨平台使用的证据；已安装原生字节是特定宿主的证据。新 runtime 使用独占创建的目录，由当前 Node 进程无 shell 地执行准确的 `pnpm@11.7.0` JavaScript 入口。官方构建和 runtime 准备都从该包 manifest 解析公开的 `bin.pnpm` JavaScript 入口，内部可执行文件不能替代声明入口。新依赖安装保留 `install --prod --no-frozen-lockfile`，通过 `--config.npmrc-auth-file=<path>` 传入本地空 npmrc；单个配置参数避免路径被当成位置参数包名，并排除用户 npmrc。包名／版本、包目录内的普通入口文件及匹配的 realpath 均须通过检查；安装在核验实际 `--version` 输出后记录 CLI 文件 hash。安装回执记录官方来源、输入描述文件摘要、平台、架构以及 Node 和 pnpm 身份。[runtime 库存](../../../../scripts/desktop-base-runtime.ts)另行对物理文件和目录内符号链接记录指纹。已有输出要求回执匹配并通过完整库存检查；失败不会触发自动删除或重新安装。

缺少新版安装回执的已验收 S2 runtime 使用[只读审计导入](../../../../scripts/import-desktop-official-runtime.ts)。构建负责人提供可信的外置审计摘要，绑定已验证包描述文件、runtime 库存、当前原生平台和带 hash 的原生证据。导入不会写入内部回执或更改不可变 runtime。其他操作系统或架构的审计不能授权当前宿主复用。

包枚举接受普通 `.tgz` 文件，仅排除固定官方打包器在 `dsh` 与 `vendor` 家族生成的普通 `publish-order.txt` 附属文件。未知输出名称、非普通文件对象以及 `native` 家族中的该附属文件均会使准备失败；每个 tarball 仍须经过检查及完整的 275 包校验。[Windows 工作流](../../../../.github/workflows/windows-desktop.yml)在 checkout 后的 PowerShell 步骤中，通过 `GITHUB_ENV` 从此时可用的 `RUNNER_TEMP` 初始化暂存及构建路径。

显式 `--build-official` 路径仅针对新的包集和描述文件输出位置，调用固定源码已有的官方构建与打包命令。它不授权重建已验收核心。[Desktop 准备说明](../../../../apps/desktop/README.zh.md#prepare-the-base-stage)给出输入和审计参数；[原生构建器](../../../../scripts/build-desktop-native.ts)单独负责外壳／客户端编译，与官方源码构建区分。

## Stage 与更新 helper 归属

默认输出为 `apps/desktop/.stage`；[基础暂存器](../../../../scripts/stage-desktop-base.ts)拒绝已有 stage。它在复制前检查 runtime，在追加两个原生客户端前验证副本，并生成 `base-smoke.json` 供识别组合的检查使用。基础 patch 仅包含两个新增客户端条目，保留完整官方 Web 依赖图。历史 full 增强清单不能充当 base 包清单或 smoke 预期。

[打包配置](../../../../apps/desktop/electron-builder.yml)将官方 runtime、组合描述文件和基础 patch 保持为 `app.asar.unpacked` 下的物理文件。Profile 解析需要真实文件系统链接目标。原生适配器解析使用单独标识的 manifest，而不修改官方包 manifest。stage 将复制的两个外壳工具声明为依赖，使用已验证的官方版本；创建输出前，包名和版本必须与 runtime 一致。pnpm 返回空依赖图时，builder 已有的遍历回退能够收集这些物理包，无须伪造安装账本或更换包管理器。收集命令未返回 JSON 仍属于错误。

[helper 准备器](../../../../scripts/prepare-desktop-helper-runtime.ts)拥有独立的 Node `24.17.0` 可执行文件及其版本来源／文件检查。正式准备要求记录真实本机 `--version` 探测；跨平台解压与注入式探测仍是不同类型的证据。已验证 helper 只读复用，打包后位于 `desktop-helper` 资源目录。这份 helper 回执不授权更新，也不能证明原生替换生命周期。

Linux `.deb` 声明 `python3`。原生更新预检仍负责判断可用能力；AppImage 环境缺少必要能力时，不能因为包准备完成而获得自动替换权限。Linux 功能完成及安装器／更新生命周期验收，与共享准备实现相互独立。

<a id="packaged-file-selection-and-permissions"></a>
## 包内文件选择与权限

[Windows 打包入口](../../../../scripts/windows-desktop-builder.ts)将全局文件模式和全部 Windows 排除规则组合到一个派生 FileSet 中。在固定版本的 builder 中，相互独立的全局和 Windows 匹配器可能复制另一个匹配器已排除的文件。派生配置在应用安全排除规则前，显式包含官方 runtime 的物理模块，并覆盖 `node-pty` 位于目录内 pnpm store 时的排除路径。两个公开 Windows 打包脚本与 CI 都使用此入口。它在改变工作目录前锚定相对 PATH 条目，并在原配置旁独占创建派生文件；原配置保留，派生文件不进入安装包。

验证 runtime 副本后，POSIX 暂存仅为其中的 `provenance.json`，以及已验库存中存在的 `desktop-official-installation.json` 添加读取权限。系统安装将文件归 root 所有后，普通用户仍须能够读取这些描述文件。源描述文件的字节和权限保持不变；其他文件、目录权限与可执行位不变。没有安装回执的已审计输入继续受支持。这些文件选择和权限检查不代表原生安装或应用启动已经验收通过。

## 已考虑的替代方案

**将历史 full 增强清单复用为 base 输入。** 已拒绝，因为包版本相同或隐藏功能都无法确认官方可执行代码来源。Base 保留完整官方 Web 图，只将原生扩展单独标识。

**重复一次性 S2 准备步骤，或重建每个已验收 runtime。** 已拒绝，因为受维护的入口能够验证输入并保留独立验收过的字节。显式新构建和经外部审计的只读复用具有不同前置条件与回执。

**将已安装 runtime 视为可跨操作系统搬运。** 已拒绝，因为源码摘要不能确认原生模块或可执行文件兼容性。平台和架构独立于来源身份检查。

## 影响

准备流程要求明确且可信的输入位置与摘要。拒绝时保留已有 stage 和 runtime，full 源码继续存在，但不会成为构建流程中隐式的 base 回退。官方源码、原生构建、helper 与 stage 各有负责人，使产物证据能够对应到具体来源；这也要求每个发布平台分别完成原生验证。

已实现的检查与当前证据包括：全部 275 个 S2 包输入的真实验证、原生客户端／主进程编译，以及真实 darwin helper 下载和版本探测。这些事实不能证明完整 CLI 到 stage 准备已完成、Linux 功能已完成、Desktop 0.6.0 已公开发布，或 macOS／Windows／Linux 已正式验收。[平台更新决策](2026-09-09-platform-specific-desktop-updates.zh.md)继续保留其独立的安装与交接要求。
