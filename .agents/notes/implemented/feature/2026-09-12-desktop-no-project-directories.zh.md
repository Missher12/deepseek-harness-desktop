# Agent Note: Desktop 非项目 Session 的持久工作目录

Status: implemented

[English](2026-09-12-desktop-no-project-directories.md) | 中文

## 问题

未注册项目的 Desktop Session 会继承应用启动目录。不同对话生成的文件可能混在一起，而启动目录随平台与安装方式变化。

## 决定

Desktop 组合为 [Session Controller](../../../../packages/api/session-controller/README.zh.md) 配置 `noProjectDirectory: deepseek-temp`。未指定 Workspace 或显式 cwd 的新普通 Session，会在 Host 用户目录下的该父目录中创建以 Session ID 命名的目录。现有 Session header 记录 cwd；工具继续通过所记录的工作目录解析相对路径。macOS、Windows 与 Linux 使用同一策略。

接管已有 Session 时先使用所记录的 cwd，再决定是否分配目录。显式 Workspace/cwd 与分支操作保留原位置。删除 Session 只移除历史，保留生成文件。新目录 ID 必须是小写、可跨平台使用的单一路径分量，排除 Windows 设备名，且不超过 128 个字符。Session 目录位置的符号链接与目录联接会被拒绝。文件系统错误会明确呈现，不会回退到应用启动目录。

该策略补充[项目 Session 存储布局](../architecture/2026-07-24-project-session-directories.zh.md)和 [Harness 主目录解析器](../architecture/2026-07-24-single-harness-home-resolver.zh.md)。这两项决定继续负责日志存储与 Harness 配置；生成文件独立于两者。现有决定均未被取代。

## 考虑过的替代方案

**共用一个临时目录。** 不采用，因为不同 Session 可能覆盖同名输出文件，文件归属仍不明确。

**升级时移动已有 Session 文件。** 不采用，因为历史提示、绝对路径引用和显式工作区依赖原有记录的位置。

**只在 Client 选择器中分配目录。** 不采用，因为其他 Session 创建入口仍会沿用不一致的默认值，各平台也可能产生差异。

## 影响

生成文件在应用重启和 Session 历史删除后保留。用户自行移除不需要的目录。默认输出位置不会限制已明确许可的绝对路径，也不替代现有文件系统权限策略。目录创建与 Session 发布是两个操作，因此 Agent 组合失败时可能留下空目录。Controller 测试覆盖独立输出、接管、显式项目、并发创建、删除后的文件保留以及文件系统错误。每个操作系统仍需完成安装包原生验证。
