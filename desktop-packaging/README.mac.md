# Intel Mac packaging

English | [中文](README.mac.zh.md)

`mac.mjs` packages the official Desktop UI and runtime with the shared blue-purple whale icon. It adds no user profile, personal plugin, language override or update feed. The application uses local ad-hoc signatures; the DMG is unsigned and neither artifact is notarized. Publication belongs to the coordinator.

After the final source checkout has a verified official build, prepare the locked runtime once. Packaging can then reuse that prepared tree:

```sh
node desktop-packaging/mac.mjs prepare
node desktop-packaging/mac.mjs package
node desktop-packaging/mac.mjs dmg
```

`package` creates the directory application. `dmg` requires a clean checkout and creates `deepseek-harness-<version>-mac-x64-local.dmg` and `mac-dmg.json` under `apps/desktop/.desktop-build/targets/mac-x64/local-artifacts/`. The receipt binds the artifact size and SHA-256 to the checkout's full Git SHA; a revision change during packaging rejects the receipt. Use only artifacts rebuilt for the coordinator's final SHA.

The local runtime signer is selected by `DSH_DESKTOP_LOCAL_MAC_ADHOC=1` in the shared preparation script. It signs Mach-O helpers before runtime inventory sealing. Helpers omit hardened runtime flags because ad-hoc code has no Team ID for native library validation; Node retains its JIT entitlement. The Electron application keeps hardened runtime signing. The formal signing branch remains separate.

Run isolated native acceptance on an Intel Mac:

```sh
node desktop-packaging/smoke-mac-dmg.mjs \
  apps/desktop/.desktop-build/targets/mac-x64/local-artifacts/deepseek-harness-<version>-mac-x64-local.dmg \
  apps/desktop/.desktop-build/mac-owner/final-dmg-smoke
```

The smoke verifies and mounts the DMG read-only, copies its app into a private temporary Applications directory, verifies its signature and icon, and launches with disposable HOME, DSH_HOME and Electron data. It checks the packaged version, UI, loopback Host with an OS-assigned port, empty external-plugin dependencies, clean exit and process teardown. It supplies no webserver profile override and makes no model call. It never replaces the user's daily application or data.
