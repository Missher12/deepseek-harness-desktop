# macOS Codex-like Boot Progress Implementation Plan

English | [中文](2026-08-20-macos-codex-boot-progress.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Codex-like Intel Mac startup surface with an immediately visible indeterminate native-runtime bar followed by real plugin activation progress.

**Architecture:** Keep the kernel-local Electron page self-contained and indeterminate because runtime startup has no trustworthy denominator. Extend the framework-free web `BootPage` with a macOS Desktop-only linear variant that derives progress from its existing active-entry set and total roster; ordinary browser and non-Mac surfaces keep the circular loader.

**Tech Stack:** Electron local renderer HTML/CSS, TypeScript DOM APIs, CSS Modules, Vitest with jsdom, pnpm, electron-builder, macOS `hdiutil`.

---

### Task 1: Replace the local Mac startup art with the approved minimal surface

**Files:**
- Modify: `apps/desktop/tests/renderer-pages.spec.ts`
- Modify: `apps/desktop/renderer/loading-macos.html`

- [ ] **Step 1: Write the failing renderer contract**

Replace the Mac loading-page assertions with the following requirements while retaining the existing external-URL rejection:

```text
expect(html).toContain("default-src 'none'")
expect(html).toContain("img-src 'self'")
expect(html).toContain('data-macos-startup')
expect(html).toContain('data-macos-local-progress')
expect(html).toContain('../assets/icon-source.png')
expect(html).toContain('正在准备你的工作区')
expect(html).toContain('启动本地服务')
expect(html).toContain('aria-valuetext="正在启动本地服务"')
expect(html).toContain('height: 5px')
expect(html).toContain('prefers-reduced-motion: reduce')
expect(html).not.toContain('class="grid"')
expect(html).not.toContain('class="rail"')
expect(html).not.toMatch(/https?:\/\//u)
```

- [ ] **Step 2: Run the renderer test and verify RED**

Run:

```bash
pnpm exec vitest run apps/desktop/tests/renderer-pages.spec.ts --config vitest.config.ts
```

Expected: the Mac case fails because the old page lacks the packaged whale image, human-readable status, five-pixel track, and minimal structure.

- [ ] **Step 3: Implement the minimal local phase**

Change the CSP to permit only the packaged local image and inline style:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'">
```

Replace the body with this semantic structure:

```html
<main class="startup" data-macos-startup aria-label="DeepSeek Harness 正在启动">
  <section class="brand">
    <img class="icon" src="../assets/icon-source.png" alt="">
    <h1>DeepSeek Harness</h1>
    <p class="subtitle">正在准备你的工作区</p>
    <div
      class="progress"
      data-macos-local-progress
      role="progressbar"
      aria-label="正在启动"
      aria-valuetext="正在启动本地服务"
    ><i aria-hidden="true"></i></div>
    <div class="meta"><span>启动本地服务</span><span>准备中</span></div>
  </section>
</main>
```

Use the approved minimal geometry and motion:

```css
body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  overflow: hidden;
  background: radial-gradient(circle at 50% 38%, rgb(77 107 254 / 10%), transparent 35%), #07090f;
}
.startup { display: grid; width: 100vw; min-height: 100vh; place-items: center; }
.brand { display: grid; width: min(300px, calc(100vw - 48px)); justify-items: center; }
.icon { width: 48px; height: 48px; border-radius: 12px; box-shadow: 0 8px 24px rgb(77 107 254 / 24%); }
h1 { margin: 17px 0 6px; font-size: 25px; font-weight: 600; letter-spacing: -.035em; }
.subtitle { margin: 0; color: #818ca5; font-size: 12px; }
.progress { position: relative; width: 100%; height: 5px; margin-top: 27px; overflow: hidden; border-radius: 999px; background: #171d2a; }
.progress i { position: absolute; inset: 0 auto 0 0; width: 34%; border-radius: inherit; background: linear-gradient(90deg, #4d6bfe, #6f8dff 68%, #79e8ff); box-shadow: 0 0 12px rgb(77 107 254 / 56%); animation: progress-sweep 1.35s cubic-bezier(.4, 0, .2, 1) infinite; }
.meta { display: flex; justify-content: space-between; width: 100%; margin-top: 10px; color: #8d98ae; font-family: "SF Mono", ui-monospace, monospace; font-size: 10px; }
.meta span:last-child { color: #d1d9ea; }
@keyframes progress-sweep { from { transform: translateX(-110%); } to { transform: translateX(400%); } }
@media (prefers-reduced-motion: reduce) { .progress i { animation: none; transform: translateX(0); } }
```

- [ ] **Step 4: Run the renderer test and verify GREEN**

Run the Step 2 command. Expected: all local renderer-page cases pass.

- [ ] **Step 5: Commit the local phase**

```bash
git add apps/desktop/tests/renderer-pages.spec.ts apps/desktop/renderer/loading-macos.html
git commit -m "feat(desktop): simplify macOS startup progress"
```

### Task 2: Render real plugin progress on the Mac Desktop web boot surface

**Files:**
- Create: `packages/client/web/src/desktop-surface.ts`
- Modify: `packages/client/web/src/DesktopBootSurface.tsx`
- Modify: `packages/client/web/src/boot-page.ts`
- Modify: `packages/client/web/src/boot-page.module.css`
- Modify: `packages/client/web/tests/boot-page.client.spec.ts`

- [ ] **Step 1: Write failing Mac Desktop progress tests**

Add a production-shaped mount helper:

```text
function mountMacDesktop() {
  const el = document.createElement('div')
  document.body.append(el)
  return {
    el,
    page: new BootPage(el, { search: '?surface=desktop', userAgent: 'Macintosh' }),
  }
}
```

Add one progress behavior test:

```text
it('shows truthful linear plugin progress on the Mac Desktop surface', () => {
  const { el, page } = mountMacDesktop()
  page.setTotal(4)
  const progress = el.querySelector<HTMLElement>('[data-dsh-boot-linear]')
  expect(el.firstElementChild?.getAttribute('data-dsh-boot-mac')).toBe('')
  expect(el.querySelector<HTMLImageElement>('[data-dsh-boot-icon]')?.src).toMatch(/\/favicon\.svg$/u)
  expect(progress?.getAttribute('aria-valuenow')).toBe('0')
  expect(el.textContent).toContain('正在加载组件 0 / 4')
  page.setState('a', 'active')
  page.setState('a', 'active')
  expect(progress?.getAttribute('aria-valuenow')).toBe('25')
  expect(el.textContent).toContain('25%')
  page.setState('b', 'active')
  page.setState('c', 'active')
  page.setState('d', 'active')
  expect(progress?.getAttribute('aria-valuenow')).toBe('100')
  expect(el.textContent).toContain('正在加载组件 4 / 4')
})
```

Extend the failure test with a Mac instance and assert that the linear progress element is replaced by the existing failure report.

- [ ] **Step 2: Run the web boot tests and verify RED**

```bash
pnpm exec vitest run packages/client/web/tests/boot-page.client.spec.ts --config vitest.config.ts
```

Expected: TypeScript/runtime failure because `BootPage` has no environment input or linear Mac progress nodes.

- [ ] **Step 3: Extract the shared surface predicate**

Create `desktop-surface.ts`:

```text
/** Identify the native macOS Desktop renderer without affecting ordinary Web. */
export function isMacDesktopSurface(search: string, userAgent: string): boolean {
  return new URLSearchParams(search).get('surface') === 'desktop'
    && /Macintosh|Mac OS X/u.test(userAgent)
}
```

Import this function from `DesktopBootSurface.tsx`, remove its duplicate implementation, and re-export it there to preserve the existing module API:

```text
import { isMacDesktopSurface } from './desktop-surface.ts'
export { isMacDesktopSurface } from './desktop-surface.ts'
```

- [ ] **Step 4: Implement the framework-free Mac progress nodes**

Add an optional environment to `BootPage`:

```text
export interface BootPageEnvironment {
  search: string
  userAgent: string
}

const browserEnvironment = (): BootPageEnvironment => ({
  search: globalThis.location.search,
  userAgent: globalThis.navigator.userAgent,
})

constructor(container: HTMLElement, environment: BootPageEnvironment = browserEnvironment()) {
  this.macDesktop = isMacDesktopSurface(environment.search, environment.userAgent)
  // existing construction continues
}
```

For the Mac branch, construct and append:

```text
this.root.dataset.dshBootMac = ''
this.icon = document.createElement('img')
this.icon.src = '/favicon.svg'
this.icon.alt = ''
this.icon.dataset.dshBootIcon = ''
this.wordmark.textContent = 'DeepSeek Harness'
this.hint.textContent = '正在准备你的工作区'
this.linear = div(css.macProgress)
this.linear.dataset.dshBootLinear = ''
this.linear.setAttribute('role', 'progressbar')
this.linear.setAttribute('aria-valuemin', '0')
this.linear.setAttribute('aria-valuemax', '100')
this.linearFill = div(css.macProgressFill)
this.linear.append(this.linearFill)
this.macStatus = div(css.macStatus)
this.macCount = div(undefined, '正在加载组件 0 / 0')
this.macPercent = div(undefined, '0%')
this.macStatus.append(this.macCount, this.macPercent)
this.card.replaceChildren(this.icon, this.wordmark, this.hint, this.linear, this.macStatus)
```

Extend `updateProgress()` after the existing arc calculation:

```text
const percent = Math.round(ratio * 100)
this.linear?.setAttribute('aria-valuenow', String(percent))
this.linearFill?.style.setProperty('--dsh-boot-progress', `${String(percent)}%`)
if (this.macCount !== undefined) this.macCount.textContent = `正在加载组件 ${String(this.active.size)} / ${String(this.total)}`
if (this.macPercent !== undefined) this.macPercent.textContent = `${String(percent)}%`
```

Restore the correct generic or Mac loading children after a failure by routing both constructor and `render()` through one `renderLoading()` helper.

- [ ] **Step 5: Add Mac-only CSS without changing the generic boot page**

Append:

```css
.boot[data-dsh-boot-mac] {
  --dsh-boot-bg: #07090f;
  --dsh-boot-label-primary: #f5f7fc;
  --dsh-boot-label-secondary: #d1d9ea;
  --dsh-boot-label-tertiary: #818ca5;
  background: radial-gradient(circle at 50% 38%, rgb(77 107 254 / 10%), transparent 35%), var(--dsh-boot-bg);
}
.boot[data-dsh-boot-mac] .card { width: min(300px, calc(100% - 48px)); gap: 0; }
.macIcon { box-sizing: border-box; width: 48px; height: 48px; padding: 7px; border-radius: 12px; background: #4d6bfe; box-shadow: 0 8px 24px rgb(77 107 254 / 24%); }
.boot[data-dsh-boot-mac] .wordmark { margin-top: 17px; font-size: 25px; line-height: 30px; font-weight: 600; letter-spacing: -.035em; }
.boot[data-dsh-boot-mac] .hint { margin-top: 6px; }
.macProgress { position: relative; width: 100%; height: 5px; margin-top: 27px; overflow: hidden; border-radius: 999px; background: #171d2a; }
.macProgressFill { width: var(--dsh-boot-progress, 0%); height: 100%; border-radius: inherit; background: linear-gradient(90deg, #4d6bfe, #6f8dff 68%, #79e8ff); box-shadow: 0 0 12px rgb(77 107 254 / 56%); transition: width 240ms ease-out; }
.macStatus { display: flex; justify-content: space-between; width: 100%; margin-top: 10px; color: #8d98ae; font-family: var(--ds-font-family-code, "SF Mono", ui-monospace, monospace); font-size: 10px; }
.macStatus > :last-child { color: #d1d9ea; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { .macProgressFill { transition: none; } }
```

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
pnpm exec vitest run \
  packages/client/web/tests/boot-page.client.spec.ts \
  apps/desktop/tests/renderer-pages.spec.ts \
  --config vitest.config.ts
```

Expected: both files pass and the existing generic circular-loader assertions remain unchanged.

- [ ] **Step 7: Commit the real plugin phase**

```bash
git add packages/client/web/src/desktop-surface.ts packages/client/web/src/DesktopBootSurface.tsx packages/client/web/src/boot-page.ts packages/client/web/src/boot-page.module.css packages/client/web/tests/boot-page.client.spec.ts
git commit -m "feat(web): show real macOS boot progress"
```

### Task 3: Regression, visual, package, and installed-app acceptance

**Files:**
- Modify: `PROJECT_CONTEXT.md`
- Verify only: all implementation files from Tasks 1 and 2

- [ ] **Step 1: Run the focused new-feature matrix**

Run the same 44-file feature matrix used before this change, plus the two new boot suites. Expected: at least 368 prior tests plus the new assertions pass.

- [ ] **Step 2: Run production builds**

```bash
pnpm run build:lib:host
pnpm run build:lib:client
pnpm run build:web
pnpm run build:desktop:main
```

Expected: all four commands exit 0.

- [ ] **Step 3: Build and exercise the Intel Mac package**

```bash
pnpm run desktop:dmg
pnpm exec vitest run apps/desktop/tests/packaged-smoke.spec.ts --config vitest.config.ts
hdiutil verify "$(find apps/desktop/release -maxdepth 1 -name 'DeepSeek-Harness-*-mac-x64.dmg' -print | sort | tail -n 1)"
```

Expected: x64 DMG build, packaged smoke, and disk-image verification pass.

- [ ] **Step 4: Verify the visual surface at 736 and 360 pixels**

Render the packaged local startup page in a real browser at both widths. Confirm the whale icon loads, the progress bar remains inside the window, text does not clip, and reduced-motion preserves the track. Start the packaged app and verify the Mac web boot phase uses the same centered composition with a monotonic percentage.

- [ ] **Step 5: Install without changing user data**

After choosing the next release version (do not reuse 0.2.1 for changed bytes), use the existing verified macOS update helper to replace `/Applications/DeepSeek Harness.app`, retain its recoverable backup, and confirm:

```text
CFBundleShortVersionString = the chosen version newer than 0.2.1
Mach-O architecture = x86_64
child arguments include --no-open --host 127.0.0.1 --port 0
listener address is 127.0.0.1:<random>
~/.dsh remains present
```

- [ ] **Step 6: Update project evidence and commit**

Record exact test totals, DMG size, SHA-256, `hdiutil`, packaged smoke, installed version, and visual acceptance in `PROJECT_CONTEXT.md`, then commit:

```bash
git add PROJECT_CONTEXT.md
git commit -m "docs(desktop): record macOS boot progress acceptance"
```

- [ ] **Step 7: Review before publication**

Inspect `git diff origin/main...HEAD`, run secret-path/high-signal scans, and verify no Windows source or asset changed. Push the branch and open a Mac-only pull request only after every prior checkbox passes. Publish a new Mac release only after merge and public-byte verification; never overwrite the already verified 0.2.1 asset with different bytes under the same version.
