# Agent Note: Desktop 从已记录基线整合官方核心

Status: implemented

[English](2026-08-31-desktop-official-core-baseline.md) | 中文

## Problem

Desktop 仓库与官方 Harness 仓库的 Git 历史互不相关，但 Desktop 源码树内嵌了官方 Harness 源码。直接合并会把完整官方源码树视为无关内容；从任意旧提交生成 diff 则会报告数千个不能描述内嵌源码关系的冲突。两条路径都可能在看似完成官方更新的同时，静默丢失 Desktop 控制、打包或客户端行为。

## Decision

每次 Desktop 核心更新都要识别 Desktop 源码已内嵌的精确官方提交与目标官方提交。整合者在两个官方提交之间计算一次三方源码增量，将其应用到 Desktop 发布分支，并且只按照当前包归属解决真实冲突。发布上下文记录两个官方身份与最终 Desktop 源码提交，后续更新不得猜测祖先。

官方包移动具有权威性。Desktop 自有行为跟随新的包归属，不保留已删除的兼容包：Session 操作归 Session Controller，workspace 归档与恢复归 Workspace Controller，设置文档归 Settings Controller，Client 贡献使用当前 Slot registry 与 Remote services。Desktop 独有的 Browser Control、Computer Use、安装器、托管扩展、布局行为和特权限制继续作为该源码之上的显式增量。

Desktop 的 Client 替换实现还要同步其官方归属所要求的传递运行时注入。例如，使用共享模型目录的替换实现必须同时声明 `remote` 与 `remote.session`；否则 Cordis 会正确地让该入口保持未激活，Slot registry 随后会选中较低优先级的回退项。

一个 Desktop 源码提交负责同一版本的全部平台构建。macOS 验证先产出该提交；Windows 任务消费相同提交与版本，不从独立解决的源码树重新构建。发布标签创建前，包安装、生成路径、依赖策略、Host 与 Client 聚合类型检查、聚焦行为测试、文档检查和打包应用 smoke 都在 lockfile 离线模式下本地运行。

## Testing

冲突标记与未合并 index 检查会拒绝不完整整合。生成路径、依赖、包 invariant、Cordis、配置、文档与翻译检查会拒绝陈旧投影。Host 与 Client 聚合构建证明已删除的包归属没有残留 import；Desktop 测试与打包 smoke 会执行保留的原生控制、安装器路径和已激活的 Client 替换席位。平台 workflow 从已打标签的源码提交构建，并在同一个 Desktop release 下发布各平台资产。

## Alternatives considered

**直接合并官方分支。** Git 无法从互不相关的仓库历史推导共享源码血缘，因此会把无关文件显示为新增与冲突。否决理由是冲突数量不再表示语义重叠，意外丢失功能也难以审查。

**用官方目标树替换 Desktop，再复制选定的 Desktop 目录。** 初始冲突列表会更短，但目录选择本身会成为未记录的 allowlist。否决理由是跨包扩展、测试、生成 catalog、包引用和安全限制都可能在不产生冲突的情况下被遗漏。

**维护独立的 macOS 与 Windows 整合分支。** 这样每个平台可以独立解决原生代码。否决理由是两个平台资产可能共用版本却包含不同的 Harness 核心与 Client 行为；平台之间应该只存在原生验证差异，不应存在源码发布身份差异。

## Consequences

官方更新需要精确的内嵌基线，也需要对每个归属变化的 Desktop 增量做明确迁移。这比复制官方源码树需要更多审查，但冲突集合保持有意义，每个平台 release 也能追溯到同一个源码提交。离线优先验证限制了依赖流量，并防止发布依赖未记录的网络解析结果。
