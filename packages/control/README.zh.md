# control/ —— Desktop 控制能力

[English](README.md) | 中文

本组负责封闭的进程协议，以及使用该协议的 Browser Control 和 Computer Control 能力家族。协议类型与服务、提供方和面向模型的工具保持分离，从而让每个进程都校验同一套操作与结果词汇。

| 包 | 职责 | 形式 |
|---|---|---|
| [`desktop-control-protocol/`](desktop-control-protocol/README.zh.md) | 严格的 protocol v1 DTO、manifest、JSON／PNG codec 与 helper 流分帧 | 库 |

本组后续包复用这些协议类型，不重新声明跨进程操作、结果或标识符。
