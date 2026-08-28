# 原生 Computer Use helper

[English](README.md) | 中文

这个 Rust workspace 构建 Desktop 主进程按需使用的私有原生 Computer Use helper。它不是网络服务：Electron 通过带长度前缀的 stdin/stdout 独占一个子进程，能力空闲时不会启动子进程。

## 契约

`protocol` crate 严格解码共享的 [`protocol-v1.json`](../../packages/control/desktop-control-protocol/protocol-v1.json)，拒绝重复或未知字段，在分配正文前执行声明长度限制，并通过 transfer ID、字节长度、SHA-256 和尺寸关联原始 PNG 帧。仓库中的 TypeScript fixture 必须逐字节往返一致。

`core` crate 负责单调时钟租约过期、精确的会话/租约/版本/目标检查、配额，以及平台无关的有界辅助功能投影。投影按广度优先遍历，并固定在深度 32、2,000 个原始节点、300 个 ref、49,152 字节语义文本、128 字节 role 和 1,024 字节 name 内；它会跳过隐藏、最小化和窗口外节点。平台接缝中不存在可编辑值字段。

在 macOS 14 及以上版本，打包 helper 实现有界观察与封闭输入清单。`status` 使用不会弹窗的屏幕录制与辅助功能预检。已授权的 `list` 结果把 SCK 窗口号绑定到 PID、内核进程启动时间和 bundle 身份。`snapshot` 将该精确 SCK 窗口唯一重新绑定到 AX 窗口，只读取 role、标题/描述、几何、可见性、最小化状态和子节点，并在返回前重新验证进程与窗口。它绝不请求 AX value 属性。可选截图只使用精确的独立窗口 `SCContentFilter`、有界 `SCStreamConfiguration` 和 `SCScreenshotManager`；图像每边最多 2,048 像素、总计最多 4,194,304 像素、PNG 最多 4 MiB，且最多尝试三次降采样。一次公开、只读的 `CGMainDisplayID` 查询会为 CLI helper 建立 SCK 所需的 CoreGraphics 显示连接；它既不是截图 fallback，也不会请求权限。JSON 与相邻 PNG 帧沿用现有 protocol-v1 关联。

完成新鲜快照后，聚焦、语义指针操作、封闭按键、有界文本、滚动与等待会在每个原生事件前重新验证精确目标、ref、权限、取消、截止时间、能力和配额。CoreGraphics 输入仅限该封闭清单。按键与按钮只在成功送达后记入 journal，并在 Stop、撤销、EOF 或恢复时释放。权限不足返回 `PERMISSION_DENIED`；Electron 映射只提供手动系统设置入口，绝不请求或修改 TCC 权限。不支持的平台继续使用空后端。

`helper` crate 负责有界 stdio 循环。畸形输入只关闭专用链路，不回显输入或操作系统诊断。EOF 是正常关闭信号。

macOS 构建为嵌套 helper 固定代码标识 `computer-use-helper`，与 Electron Builder 为裸可执行文件保留的名称一致，再把它作为显式二进制，使用与应用相同的身份签名。可持久使用的 TCC designated requirement 仍需要稳定签名证书：临时签名依旧绑定精确 CDHash。因此正式发布必须使用 Developer ID 签名与公证；替换旧的哈希标识本地 helper 后，可能需要最后手动刷新一次权限。

## 开发

`rust-toolchain.toml` 固定工具链，`Cargo.lock` 固定依赖。

```sh
cd native/computer-use-helper
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

[`scripts/build-computer-use-helper.ts`](../../scripts/build-computer-use-helper.ts) 构建一个 release 目标，并在放入 `apps/desktop/native-bin/<platform>-x64/` 前独立验证可执行文件头。Desktop staging 再次验证只有一个匹配 helper；Electron Builder 将它复制到 ASAR 外的 `resources/native/computer-use-helper[.exe]`，并把 macOS helper 纳入嵌套二进制签名流程。
