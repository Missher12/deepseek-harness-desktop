# Agent Note: 固定 Desktop Workbench 导航

Status: implemented

[English](2026-09-03-docked-desktop-workbench-navigation.md) | 中文

## 问题

Desktop Workbench 已经位于布局系统固定且可调宽的 utility 栏，但四个 Mode 仍使用横向 tabs。在 320px 最小宽度下，这些 tab 会争用同一行；renderer 重启后不会恢复选中的 Mode；若仿照参考图绘制快捷键胶囊，又会错误宣传产品实际不存在的全局快捷键。

## 决策

现有 `layout.utility` 界面继续作为唯一 Workbench 容器。容器内部以窄纵向入口和可滚动 Mode 正文组成一个双栏面板。入口顺序为审阅、终端、浏览器、文件；每项都使用真实产品图标、可省略的名称和低对比选中填充。不引入 portal、dialog、menu、popover 或 Side Chat 界面。

入口采用 ARIA 纵向 tablist 和手动选择语义。上、下键循环移动 roving focus，Home、End 到达边界，Enter 或空格选择聚焦 tab。选中 tab 与 tabpanel 携带相互对应的 `aria-controls` 和 `aria-labelledby` 身份。Escape 关闭同一个 utility 栏。由于没有全局 Workbench Mode 快捷键，界面不会绘制快捷键胶囊。

`dsh.desktop-workbench.mode.v1` 只保存 Workbench Mode 闭集中的一个成员。值缺失或非法时回退到既有的终端默认值。恢复偏好既不改变 `open`，也不改变 `sessionId`：每个 Session 仍必须由用户显式打开。选择 Mode 或显式打开某个 Mode 会更新偏好；`dsh.desktop-workbench.width.v1` 及其 320–720px 范围保持不变。

## 考虑过的替代方案

**打开 Mode 选择 popover，再在其他位置渲染内容。** 拒绝，因为它会复制导航界面，并破坏布局服务已经提供的固定栏所有权。

**在没有全局处理器时增加仿参考图的快捷键胶囊。** 拒绝，因为可见的快捷键声明必须具有对应的产品行为和测试。

**把面板打开状态与 Mode 一并持久化。** 拒绝，因为呈现偏好不得为另一个 Session 或新建 Session 自动打开 utility 界面。

## 验证

Client 测试固定纵向顺序、不存在重复浮层角色和虚假快捷键标记、tab 与 panel 身份互指、roving focus、手动选择、Escape 关闭、合法 Mode 恢复、非法值回退、不自动打开、宽度约束以及首次打开时应用宽度。CSS 测试固定有界入口栏、省略规则、选中 token 和可滚动正文。既有文件、审阅、终端、浏览器、HTTP 与 invariant 测试继续负责各 Mode 实现和 Host 边界。

## 后果

最近 Mode 是 renderer 本地的呈现状态，而当前 Session 与布局服务继续决定 Workbench 是否打开。入口刻意不提供全局单键 Mode 选择；未来只有在具备真实处理器和跨平台测试后才能增加。
