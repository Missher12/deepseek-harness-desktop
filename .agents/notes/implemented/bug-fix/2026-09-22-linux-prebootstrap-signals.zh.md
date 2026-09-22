# Agent Note：保留 Linux bootstrap 消费请求前的信号退出

Status: implemented

[English](2026-09-22-linux-prebootstrap-signals.md) | 中文

## Problem

Linux 普通进程或终端启动器可能在 bootstrap 读取私有启动请求前收到取消或超时信号。结果适配器把所有未读取请求都视为启动错误，覆盖操作系统报告的终止信号，破坏调用方对取消和超时的分类。

## Decision

只有启动器退出时没有观测到信号，未读取的启动请求才属于启动错误。普通进程和终端结果保留实际退出信号，不根据终止意图或退出码推断信号。已记录的 bootstrap 错误即使随后发生终止也仍优先报告。托管进程范围的信号发送、完全停稳检查和产物清理保留现有所有权。

## Alternatives considered

**请求终止后忽略所有未读取的请求。** 不采用，因为终止意图不能证明启动器退出的原因。

**增加超时或等待 bootstrap 后才接受取消。** 不采用，因为启动期间取消同样有效，不应取决于机器速度。

## Consequences

启动早期的信号终止进入正常的被终止或超时处理路径。没有信号的启动失败仍拒绝，已保存的 bootstrap 失败保留原始详情。单元测试覆盖普通进程和终端的 SIGTERM/SIGKILL 结果及两种失败对照；Linux CI 验证真实进程生命周期。
