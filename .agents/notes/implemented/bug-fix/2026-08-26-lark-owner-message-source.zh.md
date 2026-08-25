# Agent Note: Lark 所有者消息使用 user source

Status: implemented

[English](2026-08-26-lark-owner-message-source.md) | 中文

## 问题

通过准入的飞书所有者消息会开启普通 Harness turn，但携带的是插件消息来源。Harness 因此把它归类为注入上下文，而不是本地文本框产生的可见用户消息。所选 Session 会执行指令，但会话历史、活动时间、标题和人类消息统计不会把远程所有者输入表示为用户提示词。

## 决策

精确的配对所有者与私聊检查会在 `DurableLarkInbox` 创建 Harness 消息前确定其人类来源。因此，普通排队输入和 `/插话` steering 都使用 `source: { kind: 'user' }`，并继续走现有的 `Agent.followup()` 或 `Agent.steer()` 路径。飞书事件身份、绑定 generation、目标 Session、队列序号和投递状态继续以插件自有持久记录为准；传输元数据不会进入模型可见消息。

插件不会改写既有 Session 历史。已经用旧插件来源提交的消息仍是上下文记录，已经存在于 Agent inbox 中的消息保留其存储来源。新消息和由当前运行时重新构造的队列记录使用 user source。

## 考虑过的替代方案

**在 Client 中把 `dsh-lark` 插件上下文渲染为用户气泡。** 未采用，因为这会让可移除传输插件与 Harness 会话渲染耦合，而标题、活动时间和用量统计仍会把提示词视为非用户上下文。

**为了展示再追加一条用户消息。** 未采用，因为两条持久消息会在 Session 历史中重复提示词，并可能把同一条所有者指令向模型发送两次。

**增加新的 external-user 消息来源变体。** 未采用，因为已配对的飞书所有者就是现有 user source 表示的同一位人类，而传输来源已经在模型上下文之外拥有权威的持久记录。

## 验证

Inbox 测试要求普通消息和 steering 消息携带 user source，同时保留预写持久化、精确 Message ID、严格 FIFO、去重、重启对账、附件和按来源取消。真实 Profile 验收会选择现有 Session，发送一条飞书提示词，观察一条可见 Harness 用户消息，并确认匹配的 turn 通过现有流式卡片路径完成。

## 后果

新的飞书提示词会出现在 Harness 本地文本框提示词所在的位置，并参与普通 Session 活动时间、标题和人类消息投影。仅凭 Session 事件无法区分本地文本框与已配对飞书输入；运行来源保留在 `dsh_lark` 存储中，只有插件的显式数据清除操作会删除它。
