# @deepseek-ai/dsh-tool-browser-control

[English](README.md) | 中文

`dsh-tool-browser-control` 将 Desktop 所有的语义浏览器 surface 暴露为十二个封闭的第一方工具。本包是 [`dsh-browser-control`](../browser-control/README.zh.md) 的 Consumer，不是浏览器后端：只有存在 `ctx.browserControl` 时才会注册工具，因此普通 CLI 与 Web composition 保持不变。

## 工具与约定

- `browser_snapshot` 返回当前 URL、标题、revision、有界语义文本和不透明 ref。当精确的当前 route 声明支持图片输入，且 `ctx.attachments` 接受 PNG 时，它才请求由提供方验证过的 `ImmutablePng`，通过 `attachments.saveImage()` 提交一份新的字节副本，并把持久引用渲染为 `ImageBlock`。PNG 字节绝不会编码进文本。
- `browser_navigate` 只接受绝对目标 URL。URL 与 redirect 策略仍以 Electron 为权威。
- `browser_click`、`browser_type` 与 `browser_select` 只接受一个不透明的当前 `ref` 及各自普通操作值。`browser_scroll` 接受有界整数 delta 和可选的当前 `ref`；不存在坐标形式。
- `browser_key` 只接受一个 key 和封闭的 `Alt`／`Control`／`Meta`／`Shift` modifier 词汇。冻结协议没有 key 目标 ref。
- `browser_wait` 只接受 `duration`、`navigation` 或 `loading-idle`；只有 duration 模式接受 `duration_ms`，范围为 0–10,000 ms。
- `browser_back`、`browser_forward` 与 `browser_reload` 不接受参数。
- `browser_stop` 不接受参数、不获取 lease、不请求 approval，并等待当前官方调用会话的 `revokeSession()` 清理完成。

每个参数根都有 `additionalProperties: false`。任何工具都不接受 selector、坐标、文件、upload、chooser handle、session 或 lease 元数据、`approved`、grant、action digest 或其他看似能携带权限的字段。Consumer 从 live Agent 推导官方 session，自行创建 request ID 与 deadline，并且只在当前轮次内复用由提供方创建的一个 lease promise。轮次停止／结束、会话销毁、提供方销毁、撤销与过期都会清除缓存的 lease 状态。

已知的 password、OTP、payment、file、upload 与其他受保护目标拒绝由权威 BrowserControl 提供方以 policy result 返回。工具会把这些失败映射为脱敏拒绝，绝不渲染受保护 ref 或提供方诊断。持久 human surface 的一次性原生 challenge 同样属于提供方／Electron policy；`ctx.approval` UX 和模型参数都不是授权。

## 模型体验

只有 Desktop 提供 BrowserControl 时，模型才会看到十二个紧凑的封闭 schema。模型先调用 `browser_snapshot`，只用当前不透明 ref 执行语义目标操作，并在导航或 stale-ref 结果后重新 snapshot。Snapshot 文本有界；视觉 route 会收到一个相邻的持久图片 block，但不会因此获得坐标操作。Pending presentation 不展示输入文本和受保护页面内容。

#### KV Cache 影响

挂载 BrowserControl 时，固定 schema 会向 prompt 增加一组稳定工具。Snapshot 语义与可选图片引用属于逐次调用结果，不属于常驻 prompt 内容。不含提供方的 deployment 不增加任何 schema 或 prompt 文本。

## 已知限制与暂缓事项

- Accessibility 语义无法分类每个敏感目标，也无法证明普通页面 JavaScript 的结果。普通 click、key、selection、scroll 或 navigation 仍可能产生外部效果；提供方 policy 与可见用户控制始终是权威。
- `browser_key` 与条件 wait 是页面级协议操作，因此没有 element ref。本包不会在冻结的共享 DTO 之外虚构 ref。
- 无法发现图片能力或缺少 attachment 存储时会回退到语义文本；不会公开未提交字节或 data URL。
- 本包不负责 Browser surface、CDP、SSRF／redirect 检查、download、popup、permission、file chooser 抑制、原生 approval challenge、toolbar 或 emergency-stop UI。
