# Desktop 文件附件与记忆和学习设计

[English](2026-09-02-desktop-file-attachments-and-memory-learning-design.md) | 中文

## 目标

DeepSeek Harness Desktop 可以接收拖入或选择到输入框的文件，用用户能理解的方式呈现本地记忆，从发行版中排除尚未完成的 Browser／Computer Control 产品，并让 Intel macOS 与 Windows x64 由同一份源码提供一致行为。

## 产品范围

本版本新增 PDF、DOCX、XLSX、UTF-8 文本、Markdown、JSON、CSV、YAML、XML 与常见源代码文件附件。现有 PNG、JPEG、WebP 与 GIF 处理保持不变。目录、可执行文件、压缩包、旧版 DOC／XLS 容器、受密码保护的文档、宏载荷与未知二进制格式会被拒绝，并显示本地化错误。

Browser／Computer Control 实现不在 `origin/main` 中，本分支也不会纳入它。产品与包测试会在 Agent Control、外部 Chromium 控制扩展、Computer Control 设置或原生输入 helper 进入 Desktop staging 时拒绝构建。普通 Workbench 浏览器保留，因为它是用户工作区功能，不是浏览器自动控制。

用户可见的 `External Brain` 设置板块改为 `记忆与学习`（`Memory & Learning`）。包名、Provider 接口、本地数据库、唯一注入监听器与模型安全说明均不改变。页面只解释真实存在的两项能力：经过审核的项目记忆，以及经过验证的工作流程学习。兼容读取器细节移入辅助说明，不再伪装成第三项用户功能。

## 附件架构

### 持久内容

附件 Service Definition 在现有图片引用之外新增文档引用。文档引用只包含不透明的内容寻址 ID、经过验证的闭集媒体类型、有界字节数、清理后的显示名称与提取事实；绝不包含绝对路径、浏览器对象 URL、凭据或 Provider 文件 ID。

本地 Provider 在 `DSH_HOME` 下保存不可变的源字节与确定性提取后的 UTF-8 文本。接纳流程在发布引用前验证完整输入。取消后内容寻址写入可能留下不可达字节，与现有图片存储约定一致；系统不会追加迟到消息。

持久 Session 消息包含一个保存该引用的 `document` 内容块。请求投影读取并校验已保存的提取结果，再把内容块转换为确定性、带标签的文本段。最新消息先于旧历史获得文档预算，同一消息内的附件顺序保持稳定。最终展开会按精确解析出的 route context 与输出预留拟合；无法容纳的文档会在分发前变为确定性的仅元数据占位文本。因此，所有模型可见文本都能由 Session 日志与不可变附件存储重建。Provider adapter 不会收到文件系统路径，也不会暴露裸文件发送命令。

### 提取与限制

每条消息最多接纳五个文档与 50 MiB 源字节，每个文档最多 20 MiB。每个文档提取文本最多 96 KiB，每条消息合计最多 256 KiB。截断事实会同时写入引用和模型可见文本。

纯文本格式必须是有效 UTF-8，并拒绝包含大量 NUL 或其他二进制特征的内容。PDF 必须有 PDF 签名，并通过 PDF.js 提取且不执行嵌入动作。PDF.js 在单独打包的 Worker 中运行，设有 30 秒墙钟期限与 128MiB V8 old-generation 上限；页数、文本 item 工作量、单 item 字符数与输出字节仍分别受限。DOCX 与 XLSX 必须是有效 OOXML ZIP 容器，并满足有界 entry 清单、正确 content type 与必要文档部件；系统忽略宏与外部关系、绝不计算公式，只提取已保存的显示文本。文本构造前会限制 ZIP entry 数、展开字节、路径深度与单 entry 字节数。

浏览器只会在用户明确拖入或选择后发送 canonical base64 字节。图片与文档在 300MiB HTTP 请求上限内共享 296MiB 编码载体上限。Renderer 会在读取前检查组合上限并串行读取；Host 在解码前独立重复同一总量检查，并重新验证每个声明字段与解码字节数。文件名会规范化为 basename、移除控制字符并限制显示名称字节数。一次拖入不会授予未来文件系统访问权。

### 输入框与历史

草稿附件模型改为有序的图片或文档联合类型。图片保留缩略图和灯箱预览；文档显示紧凑文件 chip，包含名称、格式、大小、移除动作与键盘焦点。拖入遮罩与选择器只展示闭集支持类型。混合批次保持用户顺序，只要其中一项无效就原子失败。

提交后的文档内容块在会话历史中渲染为文件 chip。Host 历史、实时事件、queue frame、presenter view 与已知扩展载体只公开带进程随机 display id 的有界 renderer DTO。内容寻址 ID 与源／文本摘要留在 Host 内，不会进入 renderer payload 或 DOM。只有未来新增由用户主动发起的下载或预览功能时，源字节才可通过经过认证的 Session 附件查询获得。

## 记忆与学习体验

设置导航和页面标题使用 `记忆与学习`／`Memory & Learning`。介绍说明 DSH 会在本机召回经过审核的项目事实，并复用经过验证的工作方法。两个列表行分别展示“项目记忆”和“学到的工作流程”，以及真实的已启用、已关闭或暂不可用状态和有界数量。“工作原理”说明首步召回、项目隔离、最多六条／4 KB／150 ms 限制与故障放行行为。

页面不会声称系统记住全部对话、模型会训练自己或数据会跨设备同步。它不会暴露 Provider ID、数据库路径、原始错误或兼容存储内部细节。现有不含路径的 Host snapshot 继续作为唯一真相。

## 跨平台行为

Renderer、wire、存储、提取和模型投影代码均为跨平台实现。系统消费浏览器提供的字节，不会再次打开平台路径。测试会覆盖 Windows 风格文件名与分隔符，同时证明路径不会被接受。Desktop staging 会为 macOS 和 Windows 打入相同的包与提取资产。

Intel macOS 必须通过聚焦源码测试、生产构建、Desktop staging 与隔离 packaged smoke。Windows 源码正确性可在本机通过 TypeScript 与静态 Setup 门禁验证；原生 Setup、启动、拖入、清理与数据保留证据必须来自同一提交的 Windows x64 runner。macOS 产物永远不能替代 Windows 证据。

## 失败行为

不支持、格式错误、过大、加密或提取失败的文档会留在本地草稿并显示本地化错误；系统不会排入部分消息。持久字节缺失或损坏时，模型请求会以有界附件错误失败，而不是静默省略内容。模型 route 接收提取文本，因此文档输入不依赖图片能力声明。

记忆状态读取失败继续使用现有故障放行行为并显示“暂不可用”，绝不阻断消息。如果 Browser／Computer Control 文件重新出现，产品缺失测试会让 staging 失败。

## 考虑过的替代方案

**把拖入文件转换为 `@file`。** 不采用，因为 `@file` 表示工作区引用，不能表示用户从 Finder 或 Explorer 选择的外部文件。它也会让可见文件 chip 承诺模型可能永远收不到的内容。

**发送 Provider 专用裸文件 ID。** 不采用，因为不同 Provider 的支持不同，而且 Provider ID 不是持久产品数据。这会造成回放不一致，并给 Adapter 超出当前 Provider 中立消息模型的权限。

**把提取文本直接填进草稿。** 不采用，因为它会破坏附件身份、淹没编辑器、丢失来源，并阻碍确定性历史渲染。

**与控制功能一起删除 Workbench 浏览器。** 不采用，因为 Workbench 浏览器是普通 Desktop 工作区工具，不包含尚未完成的 Browser／Computer Control 权限。

**重命名内部 Brain Hub 与存储包。** 不采用，因为困惑来自用户可见术语，而现有包与 Provider 约定已经执行预期的本地安全模型。

## 验收

- 混合图片／文档拖入和选择器流程由同一份源码在 macOS 与 Windows 工作。
- PDF、DOCX、XLSX 与文本／代码 fixture 生成有界、确定性的模型文本和持久历史 chip。
- 格式错误、过大、加密、可执行、压缩包、旧版 Office 与未知二进制输入生成零持久引用和零提交消息。
- 绝对路径、源字节、凭据、Provider 文件 ID 与原始提取错误不会进入 Session JSON、UI snapshot、日志或模型元数据。
- 组装后的 Desktop 显示 `记忆与学习`／`Memory & Learning`，不存在用户可见的 `External Brain` 标签。
- Desktop manifest、staging、tool catalog、设置导航与 packaged smoke 不包含 Browser／Computer Control 产品入口或运行时产物。
- 发布前，macOS packaged 证据和 Windows 原生证据必须指向同一个最终 Git 提交。
