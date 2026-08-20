# Desktop 系统更新设置

[English](README.md)

这个 Desktop 专用客户端包向设置贡献“系统更新”分区。它渲染狭窄的 `window.dshDesktop` 更新状态，并且只调用由 Electron 主进程拥有的固定检查、下载和安装操作。

本包绝不选择仓库、网络 URL、目标路径、校验和或可执行命令。官方 Harness 标签只用于提示；只有通过验证的 Intel macOS Desktop 发布清单才能启用下载与安装。

## 模型体验

无，因为这个浏览器侧 Desktop 更新分区不注册模型工具、prompt 文本、提供方请求或会话事件。

#### KV Cache 影响

检查、下载或安装 Desktop 更新不会改变模型上下文或提供方请求前缀。

## 已知限制与暂缓事项

- 更新需要一个版本更高且兼容的 Intel macOS Desktop 清单，并且 DMG 大小与 SHA-256 必须匹配；仅有官方 Harness 源码标签不能安装。
- 本地未签名构建首次启动时可能需要使用 Finder 的**打开**操作。签名与公证需要外部 Apple 凭据。
- 下载与安装始终是显式用户操作。本包不会静默后台替换，也不负责跨平台更新。
