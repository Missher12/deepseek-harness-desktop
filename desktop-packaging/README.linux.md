# Ubuntu installers

The deb and AppImage contain the same official Desktop runtime. Verify their bytes, and the adjacent `linux-appimage-policy.sh` helper, using the delivered checksum file before installation. The deb manages its AppArmor profile through its installer; no separate policy step is needed.

Ubuntu 24.04 restricts unprivileged user namespaces by default. An AppImage needs an application-specific policy to retain the Chromium sandbox. Keep the AppImage at its final absolute path, then run:

```sh
chmod u+x /absolute/path/deepseek-harness-0.1.6-alpha.2-linux-x64.AppImage
sudo bash linux-appimage-policy.sh install /absolute/path/deepseek-harness-0.1.6-alpha.2-linux-x64.AppImage
/absolute/path/deepseek-harness-0.1.6-alpha.2-linux-x64.AppImage
```

The helper requires `apparmor` and `apparmor-utils`. It permits user namespaces only for the selected canonical path and refuses AppArmor pattern or control characters. `describe` prints that path and the policy identity without administrator access. It does not change global sysctl settings or disable the Chromium sandbox. An administrator must approve this application-specific grant; systems that forbid it should use their supported deb installation policy.

Before moving or deleting the AppImage, quit it and remove its policy using the same path:

```sh
sudo bash linux-appimage-policy.sh remove /absolute/path/deepseek-harness-0.1.6-alpha.2-linux-x64.AppImage
```

The disposable native check records the actual user-namespace restriction, policy identity and install/remove results. Ubuntu 24.04 checks stop if the observed restriction is not `1`; they never change the host setting to make a check pass. Kernel policy activation and application readiness require native Ubuntu evidence.
