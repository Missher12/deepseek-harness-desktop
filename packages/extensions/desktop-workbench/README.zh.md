# @deepseek-ai/dsh-desktop-workbench

[English](README.md) | 中文

DeepSeek Harness Desktop 专用的 Codex 风格实用工作台。`Session log` 旁边只有一个紧凑按钮，点击后打开可调宽的右侧面板，包含终端、浏览器、文件和审阅。该包只由 `apps/desktop/desktop.cordis.patch.yml` 挂载；普通 Web profile 不会加载它。

## 边界

- 终端由用户单独持有，绝不会进入 Agent 终端注册表。Windows 打开系统内置 PowerShell；POSIX 平台打开首个可用的 zsh 或 bash 登录 shell。一个 Client 最多打开四个 shell；输入限制为 16 KiB，保留输出限制为 1 MiB，切换关闭或插件卸载时会终止全部 shell。
- 浏览器内容运行在启用 sandbox、context isolation 和 web security 的 Electron `WebContentsView` 中。只接受 HTTP(S) 导航；弹窗、下载、权限请求和非 Web scheme 全部拒绝。切换模式或收起工作台只暂停原生像素并保留页面；应用生命周期清理才会销毁原生视图。
- 文件和审阅严格只读。Host 从当前会话解析工作区，拒绝目录穿越和符号链接逃逸，目录最多返回 200 行，文本和 Git diff 预览限制为 256 KiB。
- 面板宽度限制为 420–1,600px，默认 720px，并由唯一布局状态源保存在本地。它始终是真正可调宽的网格列：左侧导航临时让出为紧凑控制栏时，它可以占用大部分视口，但绝不会浮在会话或输入框上。分隔条支持鼠标和键盘调宽。浏览器模式会把实时 DOM 宿主的精确 x／y／width／height 与暴露状态串行同步到原生 `WebContentsView`，包括仅位置发生变化的布局，因此视图会留在右侧工作台内，不会漂移覆盖中间空白内容。对话框、Tooltip、隐藏的 document 或其他相交表层会暂停原生像素；关闭它们只恢复当前 mount 与已保留地址。终端轮询只在终端模式挂载期间存在；浏览器原生资源只在应用生命周期清理时销毁；思考文字追上后没有空闲动画。

Host HTTP bridge 只绑定当前随机 loopback origin，并要求注入可信 Desktop 文档的 generation capability。它不会向其他 origin 暴露文件系统、Git 或终端操作。

## 模型体验

无，因为这个浏览器侧 Desktop 实用界面不注册任何面向模型的内容；文件、审阅、浏览器和用户持有的终端都不会自动进入模型上下文。

#### KV Cache 影响

打开工作台、调整宽度或切换模式都不会改变提供方请求前缀；只有用户显式把内容复制到普通输入框后，它才会进入上下文。

## 已知限制与暂缓事项

- 内置浏览器刻意与 Harness 登录状态隔离，不提供扩展、下载、弹窗、权限提示或非 HTTP(S) 协议。
- 文件和审阅是有界预览，不是编辑器或完整 Git 客户端；二进制文件、超大文本、仓库写入、暂存和提交操作不在范围内。
- 终端标签页只存在于当前渲染器生命周期，应用重启后不会恢复。
- 工作台属于 Intel macOS 与 Windows x64 原生 Desktop 组合；普通 Web 不会挂载它。
