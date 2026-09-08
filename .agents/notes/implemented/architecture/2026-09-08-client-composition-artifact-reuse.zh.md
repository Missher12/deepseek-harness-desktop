# Agent Note: 复用不可变的客户端组合产物

Status: implemented

[English](2026-09-08-client-composition-artifact-reuse.md) | 中文

## 问题

每次有变化的 Loader flush 都会重新组合所有批次和单模块响应。冷启动期间，不变的 bundle 被反复解码、数行、生成映射和序列化。

## 决策

在每个记录上保留准备好的源码与 map section，以产物 revision 为键，因为 `rebuilt()` 会原地修改记录。完整 combo 产物以有序模块 id、revision 和显式单模块 revision 为键复用。用当前组合替换 combo 缓存，现有的上一代响应仍负责竞态请求。包 README 维护传输与保留契约。

## 考虑过的替代方案

**延迟 map 或在生产中省略它。** map 参与 combo revision 并保留调试器位置。删除它会改变现有产物契约。

**按记录身份缓存或保留每个 revision。** 身份无法识别原地重建；无界保留 revision 会泄漏过期 bundle。revision 键和当前组合保留规则避免这两个问题。

## 结果

启动和 HMR 复用不变字节，不延迟启动图就绪。代码和 map 变化仍使响应失效，有序 section 与包含 map 的摘要不变，不可用 revision 保留原有的 404 行为。回归测试限制不变 bundle 的解码次数，并覆盖提供的代码、map 重定位、仅 map 变化的重建和上一代过期。
