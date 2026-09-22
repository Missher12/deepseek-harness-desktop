# Agent Note: 在 bootstrap 消费请求前停止 Linux scope

Status: implemented

[English](2026-09-22-linux-prebootstrap-scope-stop.md) | 中文

## 问题

Linux 启动器可能在 bootstrap 消费私有启动请求前收到取消并退出。此时 user manager 仍可能把对应的临时 scope 保持为 loaded 且 active，但其中已经没有运行中的 target。此状态下 `systemctl kill` 返回 0 不能证明空 scope 会变为 inactive，因此 `waitForExit()` 可能无限等待。

## 决策

当直接启动器已经退出、请求文件仍存在，且 manager 报告 exact unit 为 loaded 和 active 时，`SystemdScopeOwner` 只发送一次 `systemctl --user stop --no-block <exact-unit>`，并继续轮询。非 missing 的 stop 失败会对 owner 可见；只有 manager 确认 unit 为 inactive 或不存在时才返回。stop 报告 missing 时仍交由既有 manager 观察处理。已消费请求、仍在运行的启动器、待处理信号强度和正常 active 后代继续沿用既有处理。

## 备选方案

**把 scope kill 返回 0 或直接启动器退出当作完全停稳。** 不采用，因为这两项观察都可能早于 manager 停止 active 的空 scope。

**扫描全局进程表或增加更长超时。** 不采用，因为 exact scope 由 systemd 所有，超时不能证明它已 inactive。

**通过 fallback owner 再发送命令。** 不采用，因为 native 启动可能已经开始，通过 fallback 重放 argv 可能让用户命令执行两次。

## 结果

bootstrap 前的取消现在会明确拆除 manager 保留的空 scope，并等待权威的 inactive 或不存在状态。已成功提交的 stop 请求不会重复发送；如果结果是 missing 且 manager 仍报告 scope active，后续仍可再次请求 stop。stop 失败仍可观察，同时不引入全局进程发现或用超时宣称已完全停稳。
