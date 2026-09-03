# 自适应思考滑块插件设计

[English](2026-08-17-adaptive-reasoning-effort-plugin-design.md) | 中文

**日期：** 2026-08-17

**状态：** 待实现

**目标：** DeepSeek Harness Web Profile 独立插件；本轮只交付 Intel macOS Desktop

## 目标

插件以 [HanaAyane/dsh-reasoning-effort](https://github.com/HanaAyane/dsh-reasoning-effort) `v0.6.0`、提交 `f94622b46078ac8c064f91bdc10ab27e8cf32270` 为来源，保留其模型与思考等级控件、Canvas 粒子、拖动反馈和深浅主题，只改变弹层放置规则并将角色滑块图案默认关闭。

用户可以独立安装、停用和删除插件。插件不修改 Harness 核心包、Electron preload、现有 Host 路由、会话数据或模型目录。它的 Host companion 只拥有并撤销下文定义的狭窄偏好设置路由。

## 来源与兼容责任

- 分支保留完整 MIT 许可证、`Copyright (c) 2026 HanaAyane`、源码链接和第三方资产归属，并把这些内容写入源码包及 Desktop 成品的 `THIRD_PARTY_NOTICES.md`。
- 分支只接受与自适应放置、默认设置、兼容检测和验证直接相关的差异；不重新绘制粒子效果。
- 安装文档明确要求原版与本分支只能启用一个，避免两个插件竞争同一个 `conversation.input.model` 槽位。
- 插件声明并锁定经过验证的 Harness peer 版本范围；当前 Desktop 基线是 `0.1.0-rc.5`，不能直接沿用上游尚未验证的 `rc.6` peer 声明。安装前的兼容检查和 staged profile 加载测试必须同时通过，失败时不得启用该包。

当前 `conversation.input.model` 是单实例槽位：原生控件以优先级 `0` 注册，本插件沿用上游优先级 `-100`，启用时覆盖原生控件，停用时释放席位并恢复原生控件。当前槽位边界会在替代控件渲染崩溃时撤销该 entry 并选回原生控件，这一已验证的席位级回退属于验收范围。

模块下载、依赖解析或插件 `apply` 在组件注册前失败时，React 席位级回退还没有机会生效，不能描述为“任何不兼容都会自动恢复”。这类失败由版本门禁、安装前检查、临时 profile 启动烟测和显式拒绝启用来防止；失败诊断必须保留原插件版本、Harness 版本和缺失服务，但不得包含凭据或会话正文。

## 模型与思考等级

插件继续通过当前会话的 `ModelDirectory` 读取模型、`reasoning.efforts`、默认等级和当前选择。档位数量、顺序、显示名和提交值完全来自 Host，不补造 `low`、`max` 或其他等级。

打开控件时刷新目录。拖动提交前再次读取最新目录，目标等级仍存在才调用目录选择方法。Host 拒绝选择时，滑块恢复到已接受的等级并通过 Harness 可见错误反馈说明失败；失败不改变会话模型选择。

当前模型没有思考能力或少于两个可选等级时，控件保留模型选择能力但不显示无意义的滑块。被寻址的子 Agent 会话继续遵守 Harness 的原生模型选择限制。

## 弹层放置

弹层通过 portal 渲染到稳定浮层根节点，每次打开时优先放在触发器下方，间距为 8 像素。测量使用 `visualViewport`、触发器的 `getBoundingClientRect()` 和弹层的实际矩形，不使用固定窗口高度推断，也不受输入栏祖先的 overflow 或 transform 裁切。

下方可以完整容纳弹层时保持向下。下方不足且上方可以完整容纳时翻到上方。两边都不足时选择可用高度较大的一侧，设置弹层最大高度并让内容区滚动；弹层始终保留在可见视口内。

横向位置以触发器对齐为起点，并在 `visualViewport` 两侧保留安全边距后 clamp。打开期间监听窗口与 `visualViewport` 的尺寸和滚动、捕获阶段的祖先滚动，以及触发器和弹层的 `ResizeObserver`。关闭时撤销全部监听。拖动过程中不因细小测量变化来回翻转；只有当前方向无法保留最小可用区域时才重新放置。

portal 不改变交互所有权：触发器继续持有 `aria-expanded` 与弹层关系，Escape 返回触发器，Tab 顺序保持连续，点击触发器或弹层内部不触发 outside-close，点击其余区域关闭弹层。

## 视觉与设置

- 粒子 streak、像素辐射、波形和 glow 由上游 Canvas 2D draw calls 与 `requestAnimationFrame` 产生，不替换为 CSS 小点、DOM 粒子或本仓库旧 WebGL 效果。
- 角色滑块图案在首次安装、设置缺失和设置损坏时都关闭；用户明确开启后，偏好写入 profile-scoped Host 设置而非随机 loopback 端口隔离的 `localStorage`，从而跨 Desktop 重启保持。
- Harness 主题变量仍是颜色来源，浅色、深色和系统主题切换无需重载。
- `prefers-reduced-motion` 停止非必要动画，但不隐藏等级、状态或可操作控件。
- 键盘方向键、Home、End、焦点样式、ARIA 值和触控拖动与指针拖动保持等价。

Host companion 注入 `settings` 与 `webServer`，拥有一个插件专属设置命名空间，并且只通过精确 GET 与 PUT 路由暴露角色滑块布尔值。注入同源 index 的 per-generation capability 用于验证 Client；路由只接受当前精确 loopback origin，不启用 CORS，校验 JSON 正文及大小，并随插件撤销。该路由不扩展 ApiProxy 设置 allowlist，也不授予通用设置访问权。

## 失败与卸载

启用预检在替代组件注册前验证精确的 Host 与 Client 服务约定。预检通过后，插件两端使用必需注入，不会无限等待永久缺失的服务。缺少经过验证的服务或槽位声明时，该版本保持停用；已经成功加载但无法渲染的 entry 由当前槽位撤销机制回到原生控件。两条路径分别测试，不混为同一种回退。

插件停用或卸载会撤销槽位、设置项、样式、事件监听器、`ResizeObserver`、动画帧和 Canvas 资源。卸载不修改模型提供方配置、会话日志或其他插件数据。

回退只保证原生模型与 Host 声明的 effort 仍可选择，不保证原生控件继续显示本插件的 Canvas 粒子、角色图案或向下优先弹层。增强视觉只属于插件正常加载的状态。

## 验证与验收

- 单元测试覆盖原始 Host 档位、目录刷新、选择成功、Host 拒绝、少于两个等级、缺少依赖和重复插件检测。
- 组件测试覆盖默认向下、底部碰撞翻转、两侧受限、视口缩放、弹层尺寸变化、拖动期间稳定、键盘与触控操作。
- 视觉与绘制测试证明粒子 streak、像素辐射和 glow 来自 Canvas draw calls，并覆盖角色首次、设置缺失和设置损坏时关闭、显式开启后跨随机端口重启保持、浅色、深色、减少动画和 200% 缩放。
- 组装后的 Web Profile 测试证明插件可独立停用，停用后原生模型选择器恢复且 Harness 正常启动。
- 故障注入分别覆盖组件渲染崩溃后的原生席位回退，以及模块、peer、缺失服务和 `apply` 失败时的安装拒绝；测试不得用前者代替后者。
- Mac Desktop 验收使用临时 `DSH_HOME`，验证安装、启动、随机端口、真实模型目录、插件卸载和完整进程清理；本轮不修改或发布 Windows 成品。

## 范围外

重新设计粒子、增加自定义思考档位、修改模型提供方配置、改动 Harness 核心槽位、自动安装原版插件、Windows 打包和应用自动更新不在本设计范围内。
