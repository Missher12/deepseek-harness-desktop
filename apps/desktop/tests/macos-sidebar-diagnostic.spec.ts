/** Diagnosis branch only: historical ba93 package, unchanged 7f helper, never release acceptance. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { _electron as electron, type Page } from 'playwright'
import { expect, it, vi } from 'vitest'
import { assertPortableMacEvidence } from '../../../scripts/macos-desktop-runtime-evidence.ts'
import { sidebarDiagnosticFailure, type SidebarDiagnosticFailure } from './sidebar-diagnostic-evidence.ts'

interface BrowserProbe {
  events: Record<string, unknown>[]
  sample: (kind: string, extra?: Record<string, unknown>) => void
  wideReady?: Promise<void>
  dispose: () => void
}
declare global { interface Window { __sidebarDiagnostic?: BrowserProbe } }

const probe = vi.hoisted(() => ({
  root: '', output: '', pids: new Set<number>(), port: 0, reached: false,
  cases: 0, failure: null as SidebarDiagnosticFailure | null, stage: 'package-verification',
  before: [] as string[], after: [] as string[], events: [] as Record<string, unknown>[],
  stop: new Error('SIDEBAR_DIAGNOSTIC_STOP'),
}))
const exec = promisify(execFile)
const dmg = process.env.DSH_MACOS_SIDEBAR_DIAGNOSTIC_DMG
const output = process.env.DSH_MACOS_SIDEBAR_DIAGNOSTIC_OUTPUT
const source = 'ba93a61a69e3a236c2f84e8fab4299285168035b'
const expectedAsar = '67051a384b6a870758b42f8f3c5868a363a108fcdfb763f0249845308ff4d95e'

async function hash(file: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk as Buffer)
  return digest.digest('hex')
}
async function tree(pid: number): Promise<number[]> {
  const { stdout } = await exec('/bin/ps', ['-A', '-o', 'pid=,ppid='])
  const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/u).map(Number))
  const found = new Set([pid])
  for (;;) {
    const before = found.size
    for (const [child, parent] of rows) {
      if (child !== undefined && parent !== undefined && found.has(parent)) found.add(child)
    }
    if (before === found.size) return [...found]
  }
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}
async function protectedBytes(): Promise<string[]> {
  return Promise.all(['package.json', 'cordis.patch.yml'].map(name => hash(
    join(probe.root, 'dsh-home/profiles/ordinary-upgrade-sentinel', name),
  )))
}
async function save(name: string, value: unknown): Promise<void> {
  assertPortableMacEvidence(value)
  await writeFile(join(probe.output, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
}
function hasStop(error: unknown): boolean {
  let current = error
  for (let i = 0; i < 5 && current instanceof Error; i++) {
    if (current === probe.stop) return true
    current = current.cause
  }
  return false
}

async function observe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const events: Record<string, unknown>[] = []
    const ids = new WeakMap<Element, number>()
    let nextId = 1
    const frame = document.querySelector<HTMLElement>('[class*="frame"]')
    if (frame === null) throw new Error('Sidebar diagnostic frame missing')
    const nodeId = (el: Element | null) => {
      if (el === null) return null
      if (!ids.has(el)) ids.set(el, nextId++)
      return ids.get(el)
    }
    const label = (el: Element | null) => {
      const value = el?.getAttribute('aria-label') ?? ''
      return /^(?:Open sidebar|Collapse sidebar|打开侧边栏|收起侧边栏)$/u.test(value) ? value : 'other'
    }
    const box = (el: Element | null) => {
      if (el === null) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    const sample: BrowserProbe['sample'] = (kind, extra = {}) => {
      if (events.length >= 400) return
      const button = Array.from(document.querySelectorAll('button')).find(el => label(el) !== 'other') ?? null
      const r = button?.getBoundingClientRect()
      const hit = r === undefined ? null : document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      events.push({ kind, atMs: Math.round(performance.now() * 10) / 10,
        viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, frame: box(frame),
        collapsed: frame.hasAttribute('data-sidebar-collapsed'), sidebar: box(document.querySelector('[class*="sidebarCol"]')),
        button: { id: nodeId(button), label: label(button), box: box(button),
          hit: hit === button || (hit !== null && Boolean(button?.contains(hit))) },
        animations: document.getAnimations().filter(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)).slice(0, 12).map(a => ({
          time: typeof a.currentTime === 'number' ? a.currentTime : null, endTime: a.effect?.getComputedTiming().endTime,
          targetId: nodeId(a.effect instanceof KeyframeEffect ? a.effect.target : null),
        })), ...extra })
    }
    const pointer = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest('button') : null
      const mouse = event as MouseEvent
      sample(event.type, { targetId: nodeId(target), targetLabel: label(target), x: mouse.clientX, y: mouse.clientY })
      queueMicrotask(() => sample(`${event.type}:microtask`))
      requestAnimationFrame(() => sample(`${event.type}:raf`))
    }
    for (const kind of ['pointerdown', 'pointerup', 'click']) document.addEventListener(kind, pointer, true)
    const mutation = new MutationObserver(() => sample('frame-mutation'))
    mutation.observe(frame, { attributes: true, attributeFilter: ['style', 'data-sidebar-collapsed'] })
    const resize = new ResizeObserver(() => {
      sample('resize-observer')
      requestAnimationFrame(() => sample('resize-observer:raf'))
    })
    resize.observe(frame)
    window.__sidebarDiagnostic = { events, sample, dispose: () => {
      mutation.disconnect(); resize.disconnect()
      for (const kind of ['pointerdown', 'pointerup', 'click']) document.removeEventListener(kind, pointer, true)
    } }
    sample('before-helper')
  })
}

// Intercept only the target seam to observe it and stop subsequent acceptance.
// The shipped helper, its click and all original timeouts execute unchanged.
vi.mock('./turn-navigation-viewport.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./turn-navigation-viewport.ts')>()
  return { ...original, prepareTurnNavigationViewport: async (page: Page) => {
    probe.reached = true
    probe.port = Number(new URL(page.url()).port)
    probe.before = await protectedBytes()
    await observe(page)
    try {
      for (let i = 0; i < 4; i++) {
        probe.stage = 'wide-reset'
        if (i > 0) {
          // Await the wide observation, not an already-true expanded attribute.
          await page.evaluate(() => {
            const state = window.__sidebarDiagnostic!
            state.wideReady = new Promise<void>((resolveReady, reject) => {
              const timer = window.setTimeout(() => { observer.disconnect(); reject(new Error('Wide reset observation timeout')) }, 15_000)
              const observer = new ResizeObserver(() => {
                if (document.querySelector('[class*="frame"]')?.getBoundingClientRect().width !== 1600) return
                observer.disconnect()
                requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
                  clearTimeout(timer); resolveReady()
                })))
              })
              observer.observe(document.querySelector('[class*="frame"]')!)
            })
          })
          await page.setViewportSize({ width: 1600, height: 1000 })
          await page.evaluate(() => window.__sidebarDiagnostic!.wideReady)
          await expect.poll(() => page.locator('[class*="frame"][data-sidebar-collapsed]').count(), { timeout: 15_000 }).toBe(0)
        }
        probe.stage = `prepare-${String(i)}`
        await page.evaluate(index => window.__sidebarDiagnostic!.sample(`case-${String(index)}-start`), i)
        await original.prepareTurnNavigationViewport(page)
        probe.cases++
      }
    } catch (error) {
      probe.failure = sidebarDiagnosticFailure(error)
    } finally {
      probe.events = await page.evaluate(() => {
        const state = window.__sidebarDiagnostic!
        state.sample('after-helper'); state.dispose(); return state.events
      })
      probe.after = await protectedBytes()
      await page.screenshot({ path: join(probe.output, 'sidebar.png') })
    }
    throw probe.stop
  } }
})

it.skipIf(process.platform !== 'darwin' || dmg === undefined)(
  'records one historical-package sidebar failure or four independent single-click successes', async () => {
    if (dmg === undefined || output === undefined) throw new Error('Sidebar diagnostic configuration missing')
    probe.output = resolve(output)
    await mkdir(probe.output, { recursive: false, mode: 0o700 })
    const mount = await mkdtemp('/private/tmp/dsh-macos-sidebar-mount-')
    probe.root = await mkdtemp('/private/tmp/dsh-macos-sidebar-fixture-')
    const existingChildren = new Set(await tree(process.pid))
    let mounted = false
    let detached = false
    let packageVerified = false
    let poll: ReturnType<typeof setInterval> | undefined
    let polling = Promise.resolve()
    let inspectionFailed = false
    let stopObserved = false
    let restoreLaunch = () => {}
    let forcedCleanup = false
    let remaining: number[] = []
    let listeners: number | null = null
    try {
      expect((await lstat(dmg)).isFile()).toBe(true)
      expect((await lstat(dmg)).size).toBe(184203925)
      expect(await hash(dmg)).toBe('1f4056707b9dabd37b83ee0d74607b3947b7ac5cdf7f94c017e45506121861e0')
      expect((await readFile(`${dmg}.sha256`, 'utf8')).trim()).toBe('1f4056707b9dabd37b83ee0d74607b3947b7ac5cdf7f94c017e45506121861e0  DeepSeek-Harness-0.5.7-mac-x64.dmg')
      await exec('/usr/bin/hdiutil', ['verify', dmg])
      await exec('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmg])
      mounted = true
      const app = join(mount, 'DeepSeek Harness.app')
      const executable = join(app, 'Contents/MacOS/DeepSeek Harness')
      expect((await exec('/usr/bin/lipo', ['-archs', executable])).stdout.trim()).toBe('x86_64')
      expect((await exec('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(app, 'Contents/Info.plist')])).stdout.trim()).toBe('0.5.7')
      expect((await exec('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(app, 'Contents/Info.plist')])).stdout.trim()).toBe('ai.deepseek.harness.desktop')
      expect(await hash(join(app, 'Contents/Resources/app.asar'))).toBe(expectedAsar)
      const metadata: unknown = JSON.parse(await readFile(join(app, 'Contents/Resources/update-metadata.json'), 'utf8'))
      expect(metadata).toMatchObject({ desktopVersion: '0.5.7', harnessVersion: '0.1.3-alpha.1', platform: 'darwin', arch: 'x64' })
      packageVerified = true
      const home = join(probe.root, 'home')
      await mkdir(home, { mode: 0o700 })
      await mkdir(join(probe.root, 'tmp'), { mode: 0o700 })
      await mkdir(resolve('apps/desktop/release'), { recursive: true })
      const launch = electron.launch.bind(electron)
      const spy = vi.spyOn(electron, 'launch').mockImplementation(async (options) => {
        const app = await launch({ ...options, env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home,
          TMPDIR: join(probe.root, 'tmp') + '/', DSH_HOME: join(probe.root, 'dsh-home'),
          XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'),
          ...(process.env.LANG === undefined ? {} : { LANG: process.env.LANG }),
          ...(process.env.TZ === undefined ? {} : { TZ: process.env.TZ }),
          DSH_TELEMETRY_DISABLED: '1', DSH_DESKTOP_SMOKE_MODEL_KEY: 'desktop-smoke-placeholder-key',
          DEEPSEEK_API_KEY: '', DEEPSEEK_BASE_URL: options?.env?.DEEPSEEK_BASE_URL ?? '',
          MISSHER_TENCENTDB_DIR: join(probe.root, 'unconfigured-memory'),
        } })
        const pid = app.process().pid
        if (pid === undefined) throw new Error('Diagnostic app PID missing')
        probe.pids.add(pid)
        poll = setInterval(() => {
          polling = polling.then(async () => { if (alive(pid)) for (const child of await tree(pid)) probe.pids.add(child) })
            .catch(() => { inspectionFailed = true })
        }, 250)
        return app
      })
      restoreLaunch = () => { spy.mockRestore() }
      vi.stubEnv('DSH_DESKTOP_SMOKE_ROOT', probe.root)
      vi.stubEnv('DSH_DESKTOP_SMOKE_DSH_HOME', join(probe.root, 'dsh-home'))
      vi.stubEnv('DSH_DESKTOP_SMOKE_USER_DATA', join(probe.root, 'electron-data'))
      probe.stage = 'smoke-preconditions'
      const { runPackagedDesktopSmoke } = await import('./packaged-smoke.ts')
      await runPackagedDesktopSmoke(executable, 'darwin')
    } catch (error) {
      stopObserved = hasStop(error)
      if (!stopObserved) probe.failure ??= sidebarDiagnosticFailure(error)
    } finally {
      restoreLaunch(); vi.unstubAllEnvs()
      clearInterval(poll); await polling
      try {
        for (const pid of await tree(process.pid)) if (!existingChildren.has(pid)) probe.pids.add(pid)
      } catch { inspectionFailed = true }
      const grace = Date.now() + 10_000
      while ([...probe.pids].some(alive) && Date.now() < grace) await delay(50)
      for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
        remaining = [...probe.pids].filter(alive)
        if (remaining.length === 0) break
        forcedCleanup = true
        for (const pid of remaining) {
          try { process.kill(pid, signal) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
        }
        const deadline = Date.now() + 3000
        while ([...probe.pids].some(alive) && Date.now() < deadline) await delay(50)
      }
      remaining = [...probe.pids].filter(alive)
      if (probe.before.length === 2) {
        try { probe.after = await protectedBytes() } catch { inspectionFailed = true }
      }
      if (probe.port > 0) {
        try { listeners = (await exec('/usr/sbin/lsof', ['-nP', '-t', `-iTCP:${String(probe.port)}`, '-sTCP:LISTEN'])).stdout.trim() === '' ? 0 : 1 }
        catch (error) { if ((error as { code?: number }).code === 1) listeners = 0; else inspectionFailed = true }
      }
      if (mounted) {
        try { await exec('/usr/bin/hdiutil', ['detach', mount]); detached = true }
        catch { inspectionFailed = true }
      }
      if (!mounted || detached) await rmdir(mount)
      const protectedUnchanged = probe.before.length === 2 && JSON.stringify(probe.before) === JSON.stringify(probe.after)
      await save('diagnostic.json', { schemaVersion: 1, purpose: 'historical-package-diagnosis-not-release-acceptance',
        materialSource: source, frozenProduct: '7f544cd31c43f239c09c3a209ae0d05fe677c710', expectedAsarSha256: expectedAsar, packageVerified,
        reached: probe.reached, stage: probe.stage, casesCompleted: probe.cases, failure: probe.failure,
        protectedBefore: probe.before, protectedAfter: probe.after, events: probe.events,
      })
      await save('cleanup.json', { trackedCount: probe.pids.size, remainingCount: remaining.length, listeners,
        forcedCleanup, inspectionFailed, mounted, detached, protectedUnchanged })
      // Preserve fixtures if ownership or teardown could not be verified.
      if (remaining.length === 0 && !inspectionFailed && (!mounted || detached)) await rm(probe.root, { recursive: true })
      expect(remaining).toEqual([])
      expect(inspectionFailed).toBe(false)
      expect(forcedCleanup).toBe(false)
      if (probe.reached) { expect(listeners).toBe(0); expect(protectedUnchanged).toBe(true) }
    }
    expect(stopObserved).toBe(true)
    expect(probe.failure, 'Diagnostic failure is recorded, not converted into successful acceptance').toBeNull()
    expect(probe.cases).toBe(4)
  }, 300_000,
)
