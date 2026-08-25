# Agent Note：Lark 运行时页脚使用精确 Harness 事件

Status: implemented

[English](2026-08-26-lark-runtime-footer.md) | 中文

## 问题

Lark turn 卡片会流式显示可见文字，并保留耗时与合计 Token，但没有显示 Harness 模型 ID 或提供方。所选 Session 已经持久记录请求路由，每条 assistant 消息也会标明实际生成它的路由。

## 决策

`TurnProjection` 只携带非敏感运行时事实：提供方、模型 ID、可选推理档位、耗时和聚合后的 Harness 用量。新 turn 先从所选 live Session 最近的持久 request header 暂定模型路由。模型选择发生变化时，`request/header` 事件会在请求发出前更新路由；`assistant/message` 事件则是提供方与模型的最终权威来源。assistant 消息来源不会重复推理档位，因此当路由匹配时，保留 request header 中的推理档位。

卡片采用 OpenClaw 风格的两行页脚：第一行显示状态、耗时、模型 ID、提供方和推理档位；第二行显示输入/输出箭头、保留的合计 Token 与缓存读写计数。思考内容、请求 prompt、适配器配置、凭据和原始事件仍不会进入投影。

## 已考虑的替代方案

**只读取 Session 最新 header。** 未采用，因为模型切换可能发生在 turn 开始后，并且在请求组装完成前，header 只能算暂定信息。

**只读取 assistant 消息来源。** 未采用，因为在请求流式阶段和首批可见片段中，模型 ID 会一直缺失。

**把整个 request header 复制进卡片投影。** 未采用，因为其中包含 paired-owner 卡片不需要的 system 和工具 schema 内容。

## 验证

投影测试要求 seed 保留、request-header 替换、assistant 来源最终权威、用量保留和思考内容排除。卡片测试要求单张稳定消息、单调递增的流式文字、精确模型/提供方/推理档位标签、耗时、输入/输出箭头、合计 Token、缓存读写计数和既有的有界降级回复。

## 影响

页脚现在可以确认实际回复模型，同时不会增加模型可见上下文或改变请求路由。初始占位卡可能在很短时间内显示上一条持久路由，但模型选择变化时，request-header 事件会在模型输出前校正，assistant 消息还会最终校正实际路由。投影与卡片测试覆盖 seed 保留、路由变化、最终权威、Token 明细、缓存明细和思考文字排除。
