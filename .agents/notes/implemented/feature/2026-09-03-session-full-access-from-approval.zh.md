# Agent Note：从审批启用当前 Session Full access

Status: implemented

[English](2026-09-03-session-full-access-from-approval.md) | 中文

## 问题

审批接管原本只提供拒绝和允许一次。重复审批会让可信任务变得繁琐，但新增持久审批结果或按工具名记忆又会在缺少精确参数范围的情况下扩大 authority。

## 决策

审批卡增加**本会话不再询问**。它不会产生新的审批结果。用户打开并勾选与 Access 选择器相同的 Full access 风险确认后，client 会针对拥有当前待审批请求的 exact Session 执行既有 `/permission danger-full-access` 命令。只有命令成功且匹配时，卡片才能把当前审批回答为 `allowed-once`。

`conversation.composer` 注册项只注入一个窄 `runSessionCommand(line)` 回调。InputBar 与审批入口都通过 apply 持有的同一 helper 解析命令；两者都不会取得 Session 对象或全局权限服务。权限真相继续来自既有 Session 事件投影。另一个 Session 不受影响，之后选择 Workspace Write 会恢复该 Session 的普通审批策略。

权限命令或审批响应未完成时，卡片的三个动作全部禁用。权限命令失败或未匹配时，不发送审批响应，卡片以固定文案重新开放重试。权限已经成功改变但当前响应失败时，重试只发送 `allowed-once`，不会重复执行或回滚 Full access。原始传输错误不会渲染。

## 拒绝的替代方案

- 新增 Session 级或永久 `ApprovalOutcome`：拒绝，因为既有 outcome 无法描述安全的持久工具参数范围。
- 保存浏览器侧 grant：拒绝，因为 local storage 是呈现状态，不是 Session 权限 authority。
- 先回答审批再执行 `/permission`：拒绝，因为 Session 权限切换失败时，当前高风险动作可能已经执行。

## 验证

组件测试覆盖拒绝、允许一次、风险确认、命令先于回答的顺序、进行中禁用与重复抑制、未匹配和失败命令、固定错误文案，以及 Full access 成功后的仅响应重试。Apply 测试固定共享窄命令面；权限投影测试固定 exact Session 隔离与切回 Workspace Write。核心 `ApprovalOutcome` 联合类型保持不变。

## 后果

该选项只会通过选择当前 Session 的既有 Full access preset 来减少重复工具审批。它不影响操作系统提示、站点策略、其他 Session 或未来独立受控的高风险领域。
