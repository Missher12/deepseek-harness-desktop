# 跨会话硬停止、关闭行为与计费统计设计

[English](2026-08-23-session-stop-close-and-billing-stats-design.md) | 中文

**日期：** 2026-08-23

**状态：** 已批准实施

**目标：** DeepSeek Harness Desktop（Intel macOS 与 Windows x64）

## 目标与范围

本轮只处理三项功能：让跨会话协作可以被用户明确停止；允许用户选择关闭主窗口后保持后台运行还是退出程序；把底部统计扩展成稳定的性能行与财务行。ChatGPT 产品切换入口取消，不进入实现范围。

功能必须继续作为 Desktop 增量存在，不改变普通 Web 组合，不迁移或复制 `~/.dsh`，不暴露 API Key，也不把估算金额表述成供应商账单。

## 跨会话硬停止

当前 receipt 仍是投递、恢复、回复权限与通知的权威。首次 `send_message_to_session` 创建新的协作链；`reply_to_session` 自动继承链路。Agent 在一次回复后主动继续沟通时，必须把准确的前序 delivery ID 作为 continuation 传入，使后续发送仍属于同一条链，而不是偷偷创建无法停止的新根。

插件新增一个 `stop_session_collaboration` 工具和同源、能力令牌保护的停止路由。调用方必须是该协作链两端之一。Host 从 delivery ID 追溯根 receipt，在根上记录停止时间，把链内仍可等待或回复的 receipt 结算为 `aborted / collaboration-stopped`，撤销后续回复权限，并立即让精确等待返回停止结果。重复停止幂等；伪造、跨会话、已删除或未知 delivery ID 在任何 inbox、Session 或持久状态变化前拒绝。

已停止链不能再通过 reply 或 continuation 唤醒任一 Agent。用户之后明确使用准确 Session ID 发送一项新任务，会创建一条新的协作链，不会永久拉黑两个会话。system prompt 明确要求：完成一项任务只发送一次有效结果；纯致谢、确认收到或结束语不回复；没有用户的新要求时不得绕过停止状态新建链。文本分类器不参与安全判断，避免把自然语言误判成致谢。

普通聊天时间线保持现有 Harness 风格。已发送的跨会话行只增加一个紧凑的“停止协作”操作；停止成功后显示“已停止”，不恢复旧抽屉、独立通信按钮或卡片系统。接收方也可以在普通聊天框要求 Agent 停止当前 delivery。

## 关闭窗口行为

设置的“常规”分区增加 Desktop 专用行“关闭窗口时”，可选：

- **保持后台运行：** macOS 隐藏主窗口并保留 Dock 唤回；Windows 隐藏主窗口并保留系统托盘图标，托盘菜单提供“显示 DeepSeek Harness”和“退出”。Harness 子进程继续运行。
- **退出程序：** 主窗口关闭请求触发已有的有界 shutdown，停止拥有的 Harness 子进程树和随机回环 listener 后退出。

默认值保持现有平台行为，避免升级后静默改变习惯：macOS 默认为保持后台运行，Windows 默认为退出程序。用户选择写入 Electron `userData` 下独立的原子 JSON 偏好文件，不写入 `~/.dsh`。`Cmd+Q`、`Ctrl+Q`、应用菜单“退出”和托盘“退出”始终真正退出，不受关闭按钮偏好影响。

同一个常规设置区增加“启用峰谷价估算”开关，默认开启。关闭后，底栏同时隐藏“本轮约”“会话约”和当前峰谷档位，只保留官方余额接口返回的“可用余额”。它不是只隐藏文字：当官方未来取消峰谷规则时，旧规则不能继续在后台生成错误金额。新的固定价或新规则必须随 Desktop 更新后才能重新启用估算。

preload 只暴露读取和写入闭合枚举／布尔值的 IPC；main process 验证受信主 frame 和准确 origin。损坏或未知偏好回退到平台默认值，写入失败保留旧值并向设置界面返回有界错误。

## 底部有效统计

现有性能数据继续使用完整日志 projection，不因分页、加载更早消息或压缩而变化。布局拆成最多两条紧凑行：

1. 性能行保留轮数、步骤、LLM／工具耗时、首 token、吞吐、缓存命中及输入／输出 Token。
2. 财务行按可用数据依次显示：`本轮约 ¥… · 会话约 ¥… | 可用余额 ¥… | 工作日高峰价 / 工作日低谷价 / 周末低谷价`。

新增 `latestTurnBilling` projection。它在同一轮中按 turn/step 去重供应商 usage chunk 与最终 assistant usage，累计缓存命中、缓存未命中、缓存写入和输出 Token，并记录该轮实际使用的 provider/model。流式 chunk 只更新 Host 内部 projection 状态；只有对应 `turn/end` 才发布最新已完成轮次，因此底栏不会随每个流式帧重绘。失败或中止轮次若供应商已经上报 usage，仍在 `turn/end` 结算；完全没有 usage 的轮次不显示虚假零费用。

金额只在该轮或整段会话能证明使用单一、已内置价格的官方 DeepSeek 模型时显示。`本轮约` 使用最新已完成轮次 usage；`会话约` 保留整段累计估算。余额继续通过现有同源只读桥读取官方 `/user/balance`，只展示供应商返回的可用余额，不把“余额减估算”伪装成账面余额。

内置价格同步 2026-08-23 官方页面：`deepseek-v4-flash` 与 `deepseek-v4-flash-vision-exp` 共用 Flash 峰谷价，`deepseek-v4-pro` 使用 Pro 峰谷价。北京时间工作日 09:00–12:00、14:00–18:00 为高峰；自 2026-08-23 起周六、周日全天使用低谷价。财务行每分钟重算当前档位，并在 tooltip 中说明每百万 Token 的缓存命中、未命中和输出单价。自定义 provider、未知模型或混合模型不显示金额和价档。

所有金额标记为“约”，因为它们来自模型返回的 usage 与内置官方价，不是供应商发票。定价可能变化，后续 Desktop 发布必须重新核对官方价格页面。

## 数据与接口

- receipt 增加可选 continuation 父级和停止时间；旧 receipt 在没有这些字段时仍可读取。
- session messenger 工具输出继续隐藏 reply token，只增加停止所需的稳定状态和错误码。
- Session Messenger Client transport 增加 stop 方法；HTTP 仍限制为 loopback 同源、generation capability、有界 JSON 与精确来源会话权限。
- Desktop 偏好只包含版本号、`closeBehavior: keep-running | quit` 和 `tieredPricingEstimates: boolean`。
- `latestTurnBilling` wire view 只包含 turn、四类 token bucket 与 `none / single / mixed` 计费模型身份，不包含消息正文或凭据。

## 验收标准

- A→B→A 的 continuation 属于同一链；任一参与会话停止后，reply、continuation 和精确 wait 均稳定返回 `collaboration-stopped`，不再 wake、注入或创建消息。
- 停止另一条链、伪造 delivery、自身之外的会话或未知 receipt 均拒绝且零副作用；新的用户显式发送可以创建独立链。
- 关闭偏好跨重启保留；Mac 两个选项分别隐藏与退出；Windows 两个选项分别托盘保持与退出；所有显式 Quit 路径始终退出并清理子进程。
- 最新轮次费用在 `turn/end` 后出现，流式期间不重复渲染；分页、压缩、重载与 checkpoint 恢复不改变已结算轮次数据。
- 周末任意小时显示周末低谷价；工作日两个窗口显示高峰价，边界分钟准确切换；三个官方 V4 模型价格与官方页面一致。
- 关闭峰谷估算后，本轮／会话金额与价档同时消失，官方可用余额仍显示；重启后保持该选择。
- 无官方 DeepSeek Key、余额接口失败、未知模型或混合模型时优雅隐藏对应组，不显示零余额、错误金额或凭据。
- macOS 运行完整共享测试与隔离 packaged smoke；Windows 共享测试必须通过，最终托盘／关闭生命周期由原生 Windows CI 验收，不能由 Mac 推断。

## 范围外

ChatGPT 切换或内嵌、群聊、跨设备通信、永久屏蔽会话、任意 provider 定价抓取、账单对账、自动充值、改变 API Key 存储、ARM macOS 成品和本轮直接发布 Release 均不在范围内。
