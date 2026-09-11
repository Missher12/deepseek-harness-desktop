---
description: "查看 Desktop 与 Harness 实际运行版本，并操作经过校验的 Mac、Windows 或 Linux 更新安装包。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-system-update

[English](README.md) | 中文

<a id="summary"></a>
## 概述

在设置中查看运行中的 Desktop 与 Harness 版本、检查更新并跟踪经过校验的下载进度。受支持的原生安装包提供对应平台的安装或显示文件操作，并支持取消下载和重试错误。Electron 负责选择发行版、校验和安装；成功交接不会被当作安装完成。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [Invariant ownership](#invariant-ownership)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

“系统更新”在设置中显示 Desktop、Harness 实际运行版本和当前原生系统的更新状态。这个 Desktop 专用客户端包渲染狭窄的 `window.dshDesktop` 状态，并且只调用由 Electron 主进程拥有的固定检查、下载、取消下载和安装操作。

本包绝不选择仓库、网络 URL、目标路径、校验和或可执行命令。官方 Harness 标签只用于提示；匹配原生平台与安装格式的已验证清单才能启用 Desktop 安装包操作。

页面以状态卡片和恰好两行运行版本呈现 Desktop 与内置核心。未完成检查时不会宣称已是最新版；预发行核心带有明确标记。无障碍进度仅展示实际观测的百分比和字节数，以及经过验证的安装包文件名；未知百分比保持不确定状态。仅下载或校验期间允许取消下载。失败保持可见并可展开经过脱敏的详情，Desktop 与 Harness 各有更新说明入口。

原生状态到达前，界面显示读取中，而不是判定平台不受支持。读取失败时显示固定长度的本地化提示，并提供只调用 `getUpdateStatus` 的重试；确认状态前无法检查、下载或安装更新。界面不显示传输错误详情。

Intel macOS 点击“重启并安装”后会准备受保护的更新辅助程序，然后退出 Desktop；不会再显示额外的原生确认。Windows x64 在原生确认后提供可见的 Setup 安装向导。Linux x64 的 .deb 和 AppImage 安装包仅提供“查看安装包”；Desktop 保持运行，操作可重复执行。取消 Windows 原生确认不属于错误；交接或查看安装包不会更改运行版本，也不会宣称安装完成。

<a id="table-of-contents"></a>

<a id="invariant-ownership"></a>
## Invariant ownership

不发布不变式伴生入口，因为预加载桥接校验更新快照，渲染器只投影该状态。


<a id="model-experience"></a>
## 模型体验

无，因为本包只展示更新状态并调用 Electron 拥有的固定操作。它不组装提示词、不选择模型，也不发送提供方请求。

#### KV Cache 影响

无；本包从不参与模型请求，也不会改变其缓存行为。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **需要完整原生桥接** —— 普通浏览器或六项更新操作中缺少任意一项时，不显示本分区。正在识别、无法识别和不支持的原生目标会禁用更新操作；界面不会从浏览器推断平台。
- **固定发布通道** —— 用户不能通过本包选择仓库、镜像、资产、校验和、目标路径或安装程序命令。
- **不观测外部安装结果** —— 原生交接成功不代表安装成功，也不会推断外部 Setup 向导或软件包管理器的取消结果。只有新启动应用报告的版本才能证明它的安装版本。
- **Linux 需要手动安装** —— 指引要求安装前退出 Desktop，使用软件包管理器安装 .deb，并自行选择稳定或带版本的 AppImage 位置。现有 AppImage 策略辅助程序支持 ASCII 路径和绑定具体路径的 AppArmor 规则；移动安装包后可能需要重复对应策略步骤。更新器不会修改执行权限、沙箱或 AppArmor 策略。
- **完整性校验不等于签名** —— 清单和一致的 SHA-256 用于验证安装包完整性，不证明发布者签名或公证。签名仍由发布基础设施负责。

<a id="dev-note"></a>
### 开发备注

无。
