# Agent Note: Desktop 控制运行时恢复

Status: implemented

[English](2026-08-29-desktop-control-runtime-recovery.md) | 中文

## Problem

键盘名称跨越了三套独立维护的约定。模型工具接受任意字符串，TypeScript 原样转发，而原生 helper 只接受封闭的大写词表。因此一个小写快捷键字母就会关闭 helper 协议。Electron 又会在 dispatch 前保守记录同一个未校验按键，导致恢复 helper 也拒绝 release 请求。精确会话随后保留失败清理、报告 `NOT_SUPPORTED`，连普通只读状态都无法恢复。

浏览器地址栏还暴露了独立的 macOS 互操作缺口：部分应用只通过应用级 `AXFocusedUIElement` 标识聚焦子节点，却省略子节点自己的 `AXFocused` 布尔值。只依赖子节点布尔值，会在语义点击成功后仍拒绝文字输入。

已认证 Agent 浏览器代理还对未完成的 CONNECT 握手和已经建立的页面隧道统一使用一秒 socket 超时。有效的 Windows DNS 解析或上游建连只要稍慢，就会在本机被切断，而调用方最终只能看到导航超时。

## Decision

Protocol v1 发布唯一且精确的 `controlKeyValues` 清单。TypeScript bridge／helper codec、Rust decoder 和恢复用 release frame 都校验这份清单。模型工具只公开清单以及单个小写字母别名，并在请求到达 provider 前把别名规范为大写。因此保守 held-input journal 无法再保留恢复 helper 会拒绝的值。

当可编辑或敏感元素自身的 `AXFocused` 为真，或者它的 AX 身份等于应用的 `AXFocusedUIElement` 时，macOS 投影会把它标记为已聚焦。每个原生事件前，输入仍要求新鲜精确 ref、可编辑且非敏感的分类、当前进程／窗口身份、权限、租约、能力、配额、截止时间与取消检查。

失败的原生输入清理会继续冻结在精确官方会话上。没有活动租约时，`computer.stop` 会重试；只读的 `computer.status` 或 `computer.list` 也会先执行同一恢复，再报告可用性。外部会话不能消费或清除 journal，重试失败时 admission 继续关闭。

Generation 持有的本机回环代理会在 proxy header、请求时 DNS 校验与上游 CONNECT 尚未完成时使用十秒边界。已经建立且通过认证的隧道改用独立的六十秒 idle 边界，并继续被跟踪，以便 generation 释放时立即关闭。外层 Desktop-control deadline 不变。

## Alternatives considered

**在原生 helper 内强制转换任意按键字符串。** 这会让恢复路径接受比正常协议更宽的输入面，并保留模型、Electron 与原生代码之间的漂移，因此拒绝。

**取消文字输入的聚焦字段要求。** 点击处理器或恶意应用可以在指针事件与文字插入之间重定向输入。应用级 AX 焦点补足缺失的权威事实，不需要削弱重新校验门，因此拒绝。

**只提高外层 bridge deadline。** 本机代理会在一秒后主动销毁仍然有效的慢 CONNECT；在已断连接上等待更久无法恢复导航，只会让失败更慢，因此拒绝。

## Consequences

小写快捷键调用会在 macOS 与 Windows 上编码为规范按键，不再终止 helper。属于原会话的临时恢复失败可以在不重启 Desktop 的情况下重试，但清理成功前所有权仍保持失败关闭。

对于只在应用级发布焦点的辅助功能实现，浏览器文字输入可以正常工作；安全、歧义、过期或未聚焦字段仍然受保护。Agent 浏览器导航可以承受普通 Windows 解析延迟，同时不会把已认证代理变成无界或无认证服务。
