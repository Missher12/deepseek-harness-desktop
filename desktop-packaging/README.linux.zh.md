# Ubuntu 安装包

[English](README.linux.md) | 中文

Deb 和 AppImage 包含同一套官方桌面运行时。安装前请用交付的校验文件核对它们及相邻 `linux-appimage-policy.sh` 辅助脚本的字节。Deb 安装器自行管理 AppArmor profile，无需额外配置策略。

Ubuntu 24.04 默认限制非特权用户命名空间。AppImage 需要应用专属策略来保留 Chromium 沙箱。请先将 AppImage 放在最终绝对路径，再执行：

```sh
chmod u+x /absolute/path/deepseek-harness-0.1.6-alpha.2-linux-x64.AppImage
sudo bash linux-appimage-policy.sh install /absolute/path/deepseek-harness-0.1.6-alpha.2-linux-x64.AppImage
/absolute/path/deepseek-harness-0.1.6-alpha.2-linux-x64.AppImage
```

辅助脚本需要 `apparmor` 和 `apparmor-utils`。路径仅接受 ASCII 英文字母、数字、空格、斜杠、点、下划线和连字符，并以 `.AppImage` 结尾。它仅为这个规范化路径允许用户命名空间，拒绝其他字符。`describe` 无需管理员权限即可打印路径和策略身份。脚本保留全局 sysctl 设置及 Chromium 沙箱。此应用专属授权需要管理员批准；不允许该授权的系统应使用其支持的 Deb 安装策略。

移动或删除 AppImage 前，请先退出应用，再用相同路径移除策略：

```sh
sudo bash linux-appimage-policy.sh remove /absolute/path/deepseek-harness-0.1.6-alpha.2-linux-x64.AppImage
```

临时原生检查会记录实际用户命名空间限制、策略身份和安装及移除结果。Ubuntu 24.04 检查在限制值不是 `1` 时停止，不会为了通过检查而改变宿主设置。内核策略激活和应用就绪仍需要 Ubuntu 原生运行证据。
