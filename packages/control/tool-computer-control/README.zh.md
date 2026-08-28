# @deepseek-ai/dsh-tool-computer-control

[English](README.md) | 中文

这个可选 Consumer 通过准确十二个封闭工具公开 Desktop 所有的原生电脑控制：status、list、snapshot、focus、click、double-click、drag、type、key、scroll、wait 与 Stop。只有存在 `ctx.computerControl` 时才注册模型工具，因此普通 CLI 与 Web 行为保持不变。

## 约定

模型不能提供 session、lease、approval、request ID、deadline、进程句柄或通用原生命令。Consumer 推导官方会话，只针对 `computer_list` 返回的精确应用／窗口组合获取一个由提供方创建的 lease，并且只沿用提供方返回的 snapshot revision。Stop 不接受参数、不获取 lease，也不需要 approval。

优先使用语义 ref。只有精确的当前 route 支持图片输入时，才接受截图坐标。`computer_snapshot` 通过 `AttachmentStore` 提交已验证 PNG；原始 PNG 字节绝不会进入文本结果、日志、遥测、记忆或 MSE 输入。password、OTP、payment、file、安装、删除、权限和操作系统安全目标仍由提供方拒绝。

## 模型体验

存在提供方时，模型看到稳定的十二工具清单，并在操作前先使用 `computer_list` 与 `computer_snapshot`。缺少提供方时，不会出现任何电脑控制 schema 或 prompt 文本。输入内容不会显示在 pending presentation 中。

## 已知限制

- Accessibility 语义无法证明每个外部效果；原生 policy 与可见用户控制始终是权威。
- 坐标 click、double-click、drag 与 scroll 需要视觉 route，且始终是窗口相对坐标。
- 本包不负责原生权限提示、helper 生命周期、lease、approval、allowlist、可见状态胶囊或紧急停止 UI。
