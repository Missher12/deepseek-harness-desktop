# @deepseek-ai/dsh-client-ui-desktop-control

[English](README.md) | 中文

这是 Desktop 专属的可见电脑控制 UI。它向独立的 `layout.status` additive seat 提供紧凑的活动控制胶囊，并提供紧凑列表式“浏览器与电脑控制”设置区。胶囊显示 Agent、当前应用、操作和无需 approval 的停止按钮。0.4.3 没有暂停控制。

可选 preload bridge 只公开经过验证、无路径的状态和设置意图；绝不携带 session、lease、ref、window ID、截图、坐标、approval 数据或原生句柄。浏览器与电脑能力分别判断可用性，其可用性也与开启状态分离：已安装但关闭的能力显示为**可用 · 未开启**，只有对应 Adapter 缺失或明确不支持时才显示不可用。Bridge 缺失时插件不注册，绝不会阻塞普通聊天或启动。

设置明确显示 Agent 浏览器与电脑控制开关，并分别显示屏幕查看与辅助控制权限、由 main 所有的普通应用 allowlist、紧急快捷键和当前控制。原生状态与应用枚举分别完成；main 在内存中保留最近一次通过校验的状态和列表，后续失败只标记对应刷新行、公开长度受限的通用重试消息，并保留其他有效展示状态。两项控制默认均关闭；开启任一项都由 Electron main 原生确认并持久化。“交给 Agent”只记录浏览器接管意图，绝不会暗中开启 Agent 浏览器控制。静态界面字符串提供英文和中文。

## 已知限制

- 原生 status/list 观察是可选 main-process provider seam，会随原生 adapter 提供。
- 操作系统权限必须由用户在系统设置中手动授予。
- 截图与 accessibility 内容不会进入这个 UI 包。
