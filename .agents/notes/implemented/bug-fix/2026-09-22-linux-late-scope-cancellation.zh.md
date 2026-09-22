# Agent Note: Replay Linux cancellation after late scope establishment

Status: implemented

[English](2026-09-22-linux-late-scope-cancellation.md) | 中文

## Problem

Linux 临时 scope 可能在 `systemctl kill` 报告 unit 不存在之后才被 user manager 看见。直接启动器可能已经收到信号，但目标随后仍留在新出现的 scope 中，导致 dispose 等待一个没有被终止的后代。

## Decision

`SystemdScopeOwner` 只在 scope 信号结果明确指出 unit 不存在时记录取消请求，并保留其中最强的信号。观察到 active scope 时重放该信号；重放仍报告 unit 不存在时保留它；只有成功送达不弱于待处理请求的 scope kill 才会清除它；scope 为 inactive 或 failed 时丢弃它。非 missing 的 `SIGKILL` 失败仍作为 owner 错误对外可见。

## Alternatives considered

**等待 scope 建立后再发送取消。** 不采用，因为调用方必须能够在 bootstrap 期间取消，dispose 也不应依赖机器速度。

**通过 fallback 进程组再次发送命令。** 不采用，因为 native 启动可能已经开始，通过 fallback 重放 argv 可能让用户命令执行两次。

**把请求文件已被读取当作 scope 已可见的证明。** 不采用，因为 bootstrap 可能先读取请求，而 manager 仍未暴露临时 unit。

## Consequences

Linux 普通命令与终端 owner 在 manager 建立竞态期间保留取消请求，且不会重复直接进程组信号。后续较弱请求不会降低最强信号，待处理重试会在信号送达或确认 scope 已停止后结束。
