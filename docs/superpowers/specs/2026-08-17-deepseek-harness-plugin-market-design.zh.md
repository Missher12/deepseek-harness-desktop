# DeepSeek Harness 插件市场设计

[English](2026-08-17-deepseek-harness-plugin-market-design.md) | 中文

**日期：** 2026-08-17

**状态：** 已实现

**目标平台：** Intel macOS 与 Windows x64 上的 DeepSeek Harness Desktop

## 目标

DeepSeek Harness Desktop 在设置中接入经审计的 `dshmarket@1.10.1`。用户无需安装 Node.js 或 pnpm，无需终端、外部浏览器、管理员权限或固定端口，即可搜索、安装、更新、启用、停用和删除精选插件。

Desktop 组合复用成熟的 [dsh-market](https://github.com/dsh-market/dsh-market)，不重复实现其目录、回滚、诊断和热挂载逻辑。输入区模型控件保留 Host 声明驱动的原生简洁思考等级列表。

## 产品决策

- Desktop 锁定并重新分发 `dshmarket@1.10.1`；其精选 registry 与内置快照共同提供市场目录。
- GitHub Topics 只用于发现，不是安装接口。Desktop 不暴露自由输入的包名、命令、文件路径、registry 或可执行文件字段。
- Desktop 通过 `desktopProfiles` 与 `desktopPnpm` 提供不可变 profile 身份和内置包管理能力；Desktop 模式下市场不会安装系统 pnpm。
- pnpm 默认拒绝构建脚本的策略仍然有效；被拦截的构建必须由用户按包明确批准后重试。
- 现有模型与思考等级选择器独立于市场，继续使用 Host 元数据与校验。

## 架构

```mermaid
flowchart TD
    O["Desktop-only --patch overlay"] --> U["dshmarket settings client"]
    U --> H["Same-origin market routes"]
    H --> P["desktopPnpm service"]
    P --> C["Packaged dsh plugin and pnpm"]
    C --> A["Active DSH web profile"]
    A --> L["Loader hot mount or restart-required state"]
```

插件市场由传给内置 CLI 的 Desktop 专用 patch 挂载，并且位于 Web 参数之前。patch 先挂载一个很小的第一方 Host 适配器，发布当前 web profile 与按 generation 管理的包操作服务，再挂载锁定版本的 `dshmarket`。普通 Web 启动不会收到这个 patch。Electron preload 不新增市场、文件系统、shell、包管理或原始 IPC 方法。

## 用户界面与生命周期

锁定版本的 `dshmarket` 把已有的搜索目录、已安装列表、主题、进度、诊断、备份和包操作界面接入设置。现有第一方 Configuration 与只读 Plugin list 标签保持不变。

市场写操作要求同源回环请求。`dshmarket` 会校验目录成员与命令目标，只允许一个操作并发，针对失败操作保存 manifest dependency 快照，检查可加载的 DSH 产物和重复 Loader id，并热挂载兼容插件。其 Desktop 适配器调用 `desktopPnpm.runPlugin()`，由内置 DSH CLI 继续负责 profile 初始化、相对来源锚定与 `dsh.profile.bundles` 对账。

`desktopPnpm` 自行解析内置 pnpm 入口，拒绝空参数、含 NUL 的参数和非绝对调用目录，过滤凭据形态的环境变量，管理有界输出流，串行化操作，并把取消和整棵进程树清理交给现有 subprocess 服务。Desktop 模式禁用脱离 Electron 的自重启。可热挂载插件立即生效；其他变化明确显示为待重启，直到应用按正常流程重新启动。

## 安全与失败处理

- Desktop patch 是应用资源，不是用户可写的 profile 覆盖层。
- 一个 Cordis generation 内的 `desktopProfiles.current` 不可变。检测到 Desktop 后，市场不会回退到环境中的或猜测的 profile。
- 浏览器代码不能提交任意包目标；市场路由在写入前重新解析精选目录条目。
- pnpm 与 CLI 入口由受信任 Host 代码解析，不使用 renderer 输入。
- 包操作子进程收到去除凭据的环境，只显式获得 CLI 所需的当前 `DSH_HOME`。
- 缺少可加载 DSH 产物或 Loader id 与当前 profile 冲突的包，会在破坏下次启动前被移除。
- Desktop 服务缺失时，市场适配器保持等待，不会改用系统 pnpm 写入。
- 包操作失败、超时、取消或 manifest 部分写入，通过有界结果与回滚保护报告。
- 会话、凭据、工作区和 Electron 用户数据不会被复制、删除或写入包操作输出。

## 验证与验收

- 适配器测试覆盖不可变 profile、内置 pnpm 解析、参数与路径拒绝、单操作锁、`dsh plugin` 调用、取消、整棵进程树清理和凭据过滤。
- 集成测试证明只有 Desktop 挂载锁定版本的 `dshmarket`，普通 Web 不挂载，并且市场使用 Desktop 服务而非安装系统 pnpm。
- 真实 Web 组合无需外部凭据即可通过组装后的应用打开插件市场。
- 暂存与成品检查验证不可变 patch、provider、市场 Host/Client 产物、内置 pnpm 入口、原生模块与第三方声明。

验收要求：市场可搜索并提供安装、更新、启用、停用和删除；不需要外部运行时；不新增 preload 权限；Harness 数据保持不变；公开发布前 Intel macOS 与原生 Windows 成品检查全部通过。

## 备选方案与范围

审计 `dshmarket@1.10.1` 后不再重写第二套市场，因为重复其成熟能力会增加风险与维护成本。GitHub Topic 无法证明兼容性、作者身份、内容不可变性或生命周期脚本安全性，因此不允许任意仓库安装。

任意包规格、从 GitHub Topics 自动安装、需要管理员权限的插件、写入当前 web profile 之外的位置、代码签名、公证和市场发布者账号均不在本次范围内。
