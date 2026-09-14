---
description: "在官方 Harness Web 客户端中使用原生窗口菜单并选择关闭行为。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-desktop-shell

[English](README.md) | 中文

<a id="summary"></a>
## 概述

通过原生菜单新建会话、打开设置或进入官方会话搜索。选择关闭窗口后让 Desktop 继续运行还是退出应用。本包需要 Electron 预加载接口；普通浏览器会话保持不变。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

[Desktop 基础 patch](../../../apps/desktop/base.cordis.patch.yml) 将本插件与独立的[系统更新插件](../ui-settings-system-update/README.zh.md) 一起挂载。本包是 Cordis 插件，不是可安装为 profile 层的 Bundle。本包没有配置字段；原生预加载接口提供窗口呈现信息与持久化的关闭行为。

原生恢复设置行会打开独立 Electron 窗口，提供插件兼容与系统更新；Web Host 无法启动时也能使用。浏览器不传入插件路径或验证回调。

“常规”设置行仅读写 `closeBehavior`。原生响应与广播决定显示值；设置行不会提前假定写入成功。加载期间禁用编辑，失败时显示本地化重试提示，卸载后未完成的响应失效。价格、用量统计、模型设置和指令策略均不属于本包。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节——点击展开</summary>

[浏览器入口](src/client/index.ts) 使用官方 Cordis `Context`、本地化服务、Slots 和 `uiWorkspace`。组件从官方类型推导所有者与本地化属性；`InjectFace` 推导回调及框架绑定的可观察属性。Node 入口订阅官方启动器的 `appReady` 服务，向原生管理进程通知 Host 启动成功；卸载会取消尚未发出的通知。Electron 拥有原生窗口生命周期与偏好存储。

受限的 `window.dshDesktop` 接口为 `hidden-inset` 窗口启用 38 px 拖动条。原生 `new-session` 调用 `uiWorkspace.startSession()`。原生 `open-settings` 使用优先级为 `-100` 的 `settings.trigger` 贡献：其本地化图标与标签仅保留从已挂载组件 ref 找到的、文档规定的外层按钮。移除贡献后恢复默认触发内容；设置的显示状态仍由官方外壳拥有。

原生 `open-command-menu` 读取当前 `workspace.search.sessions.aria` 翻译，且仅点击唯一匹配并已启用的按钮。目标缺失、禁用或存在歧义时，适配器返回 `false`，原生命令分发输出诊断。它不复制搜索状态，也不依赖私有 Desktop 命令属性。卸载会移除订阅与自有样式表、清空触发按钮引用，并恢复原有 body 属性。

本包不发布运行时不变量安装器：它投射单一原生偏好来源并拥有呈现效果，没有需要断言的独立可观察关系。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [Desktop 组合范围](../../../apps/desktop/README.zh.md#composition-scope)——基础组合与完整组合的选择。
- [Web 客户端 Slots](../../../docs/subsystems/slots.zh.md)——注册方式与组件属性。
- [基础组合决策](../../../.agents/notes/implemented/architecture/2026-09-13-opt-in-official-desktop-base.zh.md)——官方运行时所有权与验证。

<a id="model-experience"></a>
## 模型体验

无；本包只处理原生窗口呈现、菜单导航和关闭偏好，不组装模型请求。

#### KV Cache 影响

无；本包不选择模型、不组装提示词，也不向提供商发送请求。

## 已知限制与暂缓事项
<a id="known-limitations-and-deferred-work"></a>

- **需要完整原生接口**——预加载接口缺失或不完整时，插件不启用。
- **固定官方版本的搜索适配**——锁定的官方客户端没有公开 `openSearch` 方法；其搜索标签或渲染按钮变化后，必须针对已安装的官方界面重新验证。
- **原生验收独立进行**——jsdom 验证命令定位、偏好更新顺序与清理；它不能证明真实 Electron 菜单行为、标题栏几何布局、安装器、发布就绪或跨平台验收。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护工作上下文——点击展开</summary>

无。

</details>
