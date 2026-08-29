# 桌面浏览器布局与可靠性实施计划

[English](2026-08-30-desktop-browser-layout-reliability.md) | 中文

## 范围

将已批准的[设计](../specs/2026-08-30-desktop-browser-layout-reliability-design.zh.md)作为一次有边界的桌面修复实现。不要增加真实公共站点写入验收，也不要扩大控制授权。

## 任务 1：互不覆盖的壳层几何

- 更新 `packages/client/ui-layout/src/client/columns.ts`、`AppFrame.tsx`、stores 与 CSS，让工作台宽度可以继续增长、左侧导航在渲染层让位为紧凑栏，并确保桌面工作台抽屉不会覆盖会话。
- 在 `packages/client/ui-layout/tests/columns.client.spec.ts` 与 `app-frame.client.spec.tsx` 中先 RED 后 GREEN，覆盖 1336px、普通桌面、工作台最大宽度、宽度恢复和两个拖动分隔条。
- 更新浏览器工作台几何测试与文档。

## 任务 2：输入框与提示轨间距

- 让提示轨边界绑定已测量的输入区，并把统计信息改为可换行、有界的普通流布局。
- 增加组件/布局回归测试，证明工具提示与状态内容不会进入输入框矩形。

## 任务 3：复杂快照与浏览器生命周期

- 用有界截断替代原始节点配额失败，优先可操作候选，并保持现有线上尺寸上限。
- 增加大型本地夹具，把必需的输入框/按钮放在大量噪声节点之后，证明快照仍成功并返回有用引用。
- 保持启动、等待、回退和 Browser Stop 恢复有界，并为已发布路径增加组合回归。

## 任务 4：Windows 安装进度

- 增加隐私安全的 NSIS 详情消息与源码/smoke 门禁，证明所有必需阶段都存在。

## 任务 5：验证与交付

- 运行 focused Vitest、TypeScript 构建、scoped lint、包/文档门禁与组装 UI 快照。
- 构建并安装 Mac 产物，使用隔离 home 启动，并运行受控浏览器夹具 smoke。
- 仅在本地门禁通过后推送 Windows 构建；在宣称 Windows 可用前，要求其打包/安装器工作流及公开产物检查通过。
