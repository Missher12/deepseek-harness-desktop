# Desktop 系统更新设置

[English](README.md)

这个 Desktop 专用客户端包向设置贡献“系统更新”分区。它渲染狭窄的 `window.dshDesktop` 更新状态，并且只调用由 Electron 主进程拥有的固定检查、下载和安装操作。

本包绝不选择仓库、网络 URL、目标路径、校验和或可执行命令。官方 Harness 标签只用于提示；只有通过验证的 Intel macOS Desktop 发布清单才能启用下载与安装。
