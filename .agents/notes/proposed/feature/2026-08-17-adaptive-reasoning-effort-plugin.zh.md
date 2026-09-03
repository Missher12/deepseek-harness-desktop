# Agent Note: 自适应思考等级插件

Status: proposed

[English](2026-08-17-adaptive-reasoning-effort-plugin.md) | 中文

## 问题

Desktop 应用需要用户要求的增强思考等级选择器，但不能再次引入难以跟随上游 Harness 更新的核心 UI 分支。原版社区包面向不同的候选发布版约定，弹层放置没有 Desktop 的视口保证，默认启用人物图案，并且无法与同一单席位的另一个占用者安全共存。

## 提案

将 `@deepseek-ai/dsh-reasoning-effort` 维护为一个可移除的双端 workspace 插件。Client 半以优先级 `-100` 占用 `conversation.input.model`，只从 `ModelDirectory` 读取模型和等级，保留锁定的上游 Canvas 算法，使用默认向下的 portal，并让人物滑块默认关闭。Host 半只拥有按 profile 保存的人物偏好及其 capability 围栏保护的 loopback 路由。

Desktop 在普通 Web 组合之后增加一条不可变 patch 配置，并通过 `workspace:^` 依赖本包。停用或移除该配置会把席位释放给优先级为 `0` 的原生选择器；核心模型选择包不作改动。

## 兼容与冲突边界

已验证边界是 Harness `0.1.0-rc.5`。原版 [`HanaAyane/dsh-reasoning-effort`](https://github.com/HanaAyane/dsh-reasoning-effort) 与本分支不能同时启用，因为两者指向同一个单席位。Desktop staging 会在删除或部署前解析其不可变 patch，并要求恰好一条规范分支配置；遇到原版身份、重复配置或缺失分支时都会拒绝。

必需 Cordis 注入会让缺失 Host 或 Client 服务的条目保持 pending，而不是局部激活。Web 启动扫尾会拒绝在模块缺失、服务 pending 或 `apply` 失败时完成加载。已经成功注册、但之后崩溃的组件则走现有席位退让路径，恢复原生条目。这两类失败路径彼此独立，并分别记录。

## 打包与归属

本包派生自上游 `v0.6.0` 的提交 `f94622b46078ac8c064f91bdc10ab27e8cf32270`。完整 MIT 许可证、作者归属、源码 URL、Canvas 实现和 sprite 均予以保留。Desktop staging 强制要求本包的 Host bundle、Client bundle、`LICENSE`、包内 `THIRD_PARTY_NOTICES.md` 和构建后的 sprite。生成的根 `THIRD_PARTY_NOTICES.md` 记录相同的来源、作者、版本和提交，确保归属信息穿过 Electron 成品边界。

## 数据与安全边界

只有 `chibiThumb` 布尔值按 profile 持久化。精确路由要求活动 loopback Host 和 Origin 以及每代 capability，不启用 CORS，也不扩展通用设置访问。本插件从不改写会话、模型 provider 配置、凭证或 Electron preload 行为。

## 验证状态

包行为、弹层放置、Host 偏好围栏、Canvas 来源、Desktop 依赖闭包、不可变 patch 冲突拒绝、必需包成品、启动拒绝证据和生成声明均有自动化覆盖。真实 staged Host 回退，以及浅色、深色、200% 缩放和减少动态效果截图仍属于发布验收，不能从单元测试或构建成功中推断。

## 考虑过的替代方案

**修改 Harness 核心 UI。** 这会让选择器与应用绑定，并在每次上游更新时增加偏移，因此用户改为选择可移除插件。

**不作修改地安装上游包。** 上游包面向不同的候选发布版约定，弹层保证与默认值不同，且可能与 Desktop 的单模型席位冲突，因此分支保留特效并适配集成边界。

**替换 Canvas 特效。** 新特效会更易于重新设计，但用户明确要求上游视觉行为，因此继续保留并归属锁定的算法和 sprite。

## 验收标准

Desktop 构建包含且只包含一条规范分支配置，并包含全部必需的 Host、Client、许可证、声明和 sprite 成品。选择器读取实时模型能力，优先向下弹出，默认关闭人物滑块，仅持久化该偏好，并在已注册组件退让时恢复原生选择器。发布前，自动化测试和文档门禁必须通过，且需用临时 `DSH_HOME` 运行 staged Host，并以浅色、深色、200% 缩放和减少动态效果截图确认真实应用行为。

## 风险

已验证边界是候选发布版，Harness 更改席位或模型合约后可能需要重新适配。缺少必需服务时会有意阻止插件注册，而注册后的渲染失败依赖共享席位回退。保留的 Canvas 代码和 sprite 带有第三方许可义务。真实 staged Host 与视觉验收仍未完成，在实际执行前必须保持明确。
