# 桌面发布流程

[English](README.md) | 中文

本流程将验收通过的桌面候选发布到 [Missher12/deepseek-harness-desktop](https://github.com/Missher12/deepseek-harness-desktop)。总指挥负责集成、发布记录和公开发布，各平台负责人从同一最终提交构建并验收隔离安装。官方运行时输入和原生打包命令见[桌面准备说明](../README.zh.md)。

## 1. 冻结候选

记录完整桌面提交、桌面版本、官方 Harness 版本和源码提交、已审查的官方包输入摘要，以及选定插件的版本、源码提交和归档哈希。确认集成 worktree 干净，保留已有发布标签与资产。

基础桌面与可选插件分别版本化并保存验收记录。私有 Media@Missher 和 MSE 核心源码及归档不得进入公开桌面资产。公开插件链接必须指向正确仓库并符合其可见性。兼容声明须注明实际测试的插件组合，安装了包不能证明它已激活。

向原生执行环境传送候选须遵守项目的当前授权。候选分支、草稿 Release 或已上传的 Actions 产物不等于正式发布。冻结后任何源码修正都需要新的最终提交，并重新取得绑定该提交的平台验收。

## 2. 收集原生验收

向各平台负责人下达同一完整提交，记录实际 runner 或宿主身份、适用的 run ID 和 attempt、原始日志、验收回执及包哈希。失败尝试单独保留；后续重试成功不能解释证据已缺失的前一次失败。

| 目标 | 验收包 | 必需的原生范围 |
| --- | --- | --- |
| Intel macOS | DMG | 隔离安装、启动、会话与历史、更新与恢复、准确进程清理、数据保护 |
| Windows x64 | Setup EXE | 可见 NSIS 生命周期、安装、会话与历史、更新交接与取消、准确进程清理、卸载及数据保留 |
| Ubuntu 22.04 x64 | deb 和 AppImage | 各格式的安装、沙箱、会话与历史、更新授权或替换、重启及数据保留 |
| Ubuntu 24.04 x64 | 同一批已验收 Linux 包字节 | 在系统用户命名空间策略下验证两种格式，并完成相同生命周期及数据检查 |

在合成且隔离的 fixture（测试前置数据）中覆盖用户之前安装的受支持版本和配置。保留既有 Session 代际及其他受保护字节，通过新应用验证旧历史。单独测试已确认故障插件的暂停和恢复，不得与取消会话混淆。安装交接、HTTP 成功或一个运行中的 PID 均不能单独证明新应用已就绪。

基础组合和选定的受支持插件组合各自完成相应检查。无项目输入、左侧轮次导航等增强行为纳入组合验收。不支持的插件平台须明确说明。源码检查、无密钥合成模型请求、开发 stage 启动与原生安装器验收分别记录。

## 3. 汇集已验收字节

将已验收的 DMG、EXE、deb 和 AppImage 复制到新的发布目录，不重新构建或重打包。逐项比较文件大小、SHA-256 与平台回执，并收集同一最终源码提交中的 Linux AppImage 策略辅助脚本。记录精确资产清单，包含所有将公开的校验文件和更新清单。

使用 [create-desktop-update-manifest.ts](../../../scripts/create-desktop-update-manifest.ts) 生成四份更新清单。参数依次为已验收包路径、输出路径、桌面版本、内含 Harness 版本和新的发布标签。标签必须是 `desktop-v<桌面版本>`。

| 安装包 | 生成器附加参数 | 输出文件名 |
| --- | --- | --- |
| DMG | 无 | `deepseek-harness-desktop-update.json` |
| Setup EXE | `--target win32-x64-nsis` | `deepseek-harness-desktop-update-win-x64.json` |
| deb | `--target linux-x64-deb` | `deepseek-harness-desktop-update-linux-x64-deb.json` |
| AppImage | `--target linux-x64-appimage` | `deepseek-harness-desktop-update-linux-x64-appimage.json` |

通过 `pnpm exec tsx scripts/create-desktop-update-manifest.ts` 运行生成器，并传入上述字面参数。它读取物理包文件，校验名称、大小、摘要、版本、目标和固定发布 URL，不验证原生验收。每个安装器及策略辅助脚本各配一份 ASCII/LF `.sha256` 文件，每行包含小写哈希、两个空格和精确资产文件名。

## 4. 发布记录中的资产

所有必需的原生回执均匹配最终提交及资产字节后，总指挥才可更新公开主分支、创建新标签和发布 Release。修改远端引用前先读取其实际状态。不得移动已发布标签或替换现有发布资产来修补失败候选。

先创建新的草稿 Release，上传记录中的精确资产且不使用覆盖参数，再核对服务端资产名称、大小和可用摘要。检查标签解析后的完整提交，仅看 Release 的分支名或 `target_commitish` 文本不足以确认源码身份。上述检查通过后才公开发布。发布说明写明内含官方版本、支持的平台与插件组合、更新行为和实质限制。

[Desktop Release Tooling 工作流](../../../.github/workflows/desktop-release.yml) 只有仓库只读权限，实际运行清单生成器、解析器和工作流限制检查。成功只证明这些工具检查通过，不构建安装器、不发布，也不授予发布许可。

## 5. 核验公开交付

重新读取公开主分支、标签解析结果、Release 状态、发布说明和完整资产清单。对记录中的每件资产，从公开 Release URL 发起全新的匿名下载，不使用 Authorization、Cookies、netrc 或带凭据的客户端配置。重新计算大小和 SHA-256，不以本地缓存或已认证的上传响应代替。

用应用自身的[发布校验器](../src/update/release.ts) 解析下载的四份更新清单，核对记录的目标、版本、安装包字节和发布 URL。检查每份已下载的校验文件指向并校验其对应资产。核对公开 README、About 简介和插件链接是否符合实际交付。

只有原生验收、公开发布和匿名验证全部通过后，才将发布记录标记为完成。集中保留最终提交、run/attempt 身份、资产清单、回执和未解决的限制。若发布成功而公开验证失败，应如实报告这个状态并保留失败证据。
