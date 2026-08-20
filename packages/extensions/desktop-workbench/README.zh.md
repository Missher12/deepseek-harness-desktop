# @deepseek-ai/dsh-desktop-workbench

[English](README.md) | 中文

DeepSeek Harness Desktop 专用的 Codex 风格实用工作台。`Session log` 旁边只有一个紧凑按钮，点击后打开可调宽的右侧面板，包含终端、浏览器、文件、侧边聊天和审阅。该包只由 `apps/desktop/desktop.cordis.patch.yml` 挂载；普通 Web profile 不会加载它。

## 边界

- 终端由用户单独持有，绝不会进入 Agent 终端注册表。一个 Client 最多打开四个 shell；输入限制为 16 KiB，保留输出限制为 1 MiB，切换关闭或插件卸载时会终止全部 shell。
- 浏览器内容运行在启用 sandbox、context isolation 和 web security 的 Electron `WebContentsView` 中。只接受 HTTP(S) 导航；弹窗、下载、权限请求和非 Web scheme 全部拒绝。关闭该模式会销毁原生视图。
- 文件和审阅严格只读。Host 从当前会话解析工作区，拒绝目录穿越和符号链接逃逸，目录最多返回 200 行，文本和 Git diff 预览限制为 256 KiB。
- 侧边聊天使用 `@deepseek-ai/dsh-session-messenger`。来源和目标两边都会出现可见会话行；只有目标 relay 进入模型历史，来源行标记为 ignorable。
- 面板宽度限制为 320–720 px 并保存在本地。终端轮询只在终端模式挂载期间存在；浏览器原生资源会在卸载时销毁；思考文字追上后没有空闲动画。

Host HTTP bridge 只绑定当前随机 loopback origin，并要求注入可信 Desktop 文档的 generation capability。它不会向其他 origin 暴露文件系统、Git 或终端操作。
