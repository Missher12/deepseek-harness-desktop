# Agent Note: Desktop control service seams

Status: implemented

[English](2026-08-28-desktop-control-service-seams.md) | 中文

## 问题

封闭的 Desktop 协议需要稳定的 Harness 服务，Host 适配器与模型工具才能使用它。把 wire DTO 复制到这些服务会形成相互竞争的词汇；公开原始原生／浏览器对象则会让陈旧或外来的引用跨越授权边界。

## 决策

`@deepseek-ai/dsh-browser-control` 注册唯一的 `ctx.browserControl` Service Definition。`@deepseek-ai/dsh-computer-control` 注册唯一的 `ctx.computerControl` Service Definition。Cordis 会拒绝这两个稳定服务键各自的第二个提供方。

两个包都从 `@deepseek-ai/dsh-desktop-control-protocol` 导入并重新导出跨进程 request、result 和 brand。它们的本地类型只覆盖同进程所有权事实与验证：浏览器 ref 绑定会话、surface、mount generation 与 snapshot revision；计算机 ref 绑定会话、应用、PID、进程创建身份、窗口、snapshot revision 与 display scale。工厂函数会拒绝 boxed 或可强制转换字段，重新构建品牌化原语值与严格五字段的 PNG 元数据对象，并在协议上限内分离及深冻结提供方输出；在 Electron 创建的更窄 lease quota 之前，服务层每轮次操作上限为 64。

共享的纯分类器与原生服务策略放在一起，只返回 `ALLOW`、`APPROVAL_REQUIRED` 或 `DENY`。它的运行时边界只接受普通对象和精确的 request kind、surface、sensitivity 与 effect 清单值；敌意或未知值会在不抛异常的情况下被拒绝。已知安全敏感目标，以及无法确定的敏感性／效果都会被拒绝。无目标的 status／list request 携带 `not-applicable`；匹配 surface 上的 Stop 只有在封闭清单校验后才无需目标分类并保持免审批。普通只读操作会获准。外部副作用与持久 human browser 变更需要后续 Electron 原生审批；模型输出与页面文本不能提供分类器所需的权威事实。

## 考虑过的替代方案

**把每项操作与结果复制到两个 Service Definition 包。** 这会使两个包表面独立，却允许进程边界处的协议发生漂移，因此协议包继续作为 DTO 唯一所有者。

**直接公开提供方原生元素对象。** 这会泄露可变的进程与 surface 内部信息，并让陈旧 ref 检查依赖调用方，因此调用方只接收不透明的 branded ref，提供方保留不可变的所有者绑定。

**把未知目标当作普通目标，只对已命名的敏感字段提问。** Accessibility 与 DOM 语义无法证明恶意页面代码或陌生原生控件没有副作用，因此不确定性会被拒绝，而不是被静默扩权。

## 后果

Host 适配器可以依赖稳定、可替换的服务，而无需导入 Electron 或原生 helper 代码。提供方实现获得可复用的所有者／新鲜度检查与不可变结果检查；后续 bridge／helper 层仍负责 lease、权限、quota、拆卸与原生执行。保守分类可能会拒绝一部分看似安全的控件，直到适配器能够权威识别它们；这是遇疑即拒所刻意承担的代价。
