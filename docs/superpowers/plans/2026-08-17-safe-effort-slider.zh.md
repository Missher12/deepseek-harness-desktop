# 安全思考等级滑块实施计划

[English](2026-08-17-safe-effort-slider.md) | 中文

**目标：** 把 Effort 子菜单中的普通列表替换成一个无障碍、带粒子效果的滑块，并且只提交 Host 声明支持的思考等级标识。

**架构：** 模型数据与写操作继续留在 `ModelSelect.tsx`；同一包内新增纯展示组件和 CSS。保留现有菜单嵌套与 `ModelDirectory.select()` 路径。粒子效果使用 CSS 元素与 transform，不新增渲染依赖。

**技术栈：** React 18、TypeScript、CSS Modules、Vitest、Testing Library。

## 任务 1：定义思考等级契约

- [ ] 在 `packages/client/ui-model-selection/tests/effort-slider.client.spec.tsx` 添加失败测试，覆盖已声明停靠点顺序、`max` → `ULTRACODE`、未知标签、方向键/Home/End、忙碌状态和减少动态效果的安全标记。
- [ ] 在 `packages/client/ui-model-selection/tests/model-select.client.spec.tsx` 添加失败的集成断言，证明 DeepSeek 的 `off/high/max` 输入绝不会提交 `low` 或 `medium`。
- [ ] 运行两个聚焦测试文件并记录预期的 RED 失败。

## 任务 2：构建展示组件

- [ ] 新增 `packages/client/ui-model-selection/src/client/EffortSlider.tsx`，接收受控值、已声明等级、禁用状态与精确提交回调。
- [ ] 实现键盘、点击和指针就近停靠，不合成任何标识。
- [ ] 增加语义化 slider 属性、停靠点标签、静态回退层，以及对辅助技术隐藏的装饰粒子。
- [ ] 在 `ModelSelect.module.css` 中添加粒子轨道、能量状态、明暗主题 token、焦点环、紧凑布局和减少动态效果规则。
- [ ] 运行聚焦组件测试直至 GREEN。

## 任务 3：接入模型选择

- [ ] 只替换 `packages/client/ui-model-selection/src/client/ModelSelect.tsx` 中 Effort 子菜单的内容。
- [ ] 保留现有待处理选择锁、乐观模型状态、错误处理、菜单锚定和 provider/model 行。
- [ ] 只在无障碍文案需要新标签时更新包内 locale。
- [ ] 运行全部 `ui-model-selection` 测试以及该包的类型检查和 lint 路径。

## 任务 4：验证组合后的 UI

- [ ] 构建 Web 客户端，并在临时 `DSH_HOME` 下打开真实 Desktop 组合。
- [ ] 验证紧凑与宽窗口、键盘焦点、明暗主题、减少动态效果，并确认控制台无错误。
- [ ] 截取评审截图，并把验证结果记录到 `PROJECT_CONTEXT.md`。
