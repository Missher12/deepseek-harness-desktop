import type { LinuxInstallResult, LinuxPackageKitEvent, LinuxPackageKitTransaction } from './linux-update-protocol.ts'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import type { LinuxDbusBus, LinuxDbusProxy } from './linux-update-protocol.ts'
import type { LinuxPackageKitClient } from './linux-install-backend.ts'

const require = createRequire(import.meta.url)
const PACKAGEKIT = 'org.freedesktop.PackageKit'
const TRANSACTION = `${PACKAGEKIT}.Transaction`

function connectSystemBus(): LinuxDbusBus {
  const library: unknown = require('@homebridge/dbus-native')
  if (typeof library !== 'object' || library === null || !('createClient' in library) || typeof library.createClient !== 'function') throw new Error('Maintained D-Bus client is unavailable')
  // Pin the real system socket; never consume a user-provided unixexec/TCP bus address.
  const createClient = library.createClient as (options: { busAddress: string }) => LinuxDbusBus
  return createClient({ busAddress: 'unix:path=/run/dbus/system_bus_socket' })
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error('PackageKit method deadline exceeded')) }, timeoutMs) })]) }
  finally { clearTimeout(timer) }
}

function getProxy(bus: LinuxDbusBus, path: string, name: string, timeoutMs: number): Promise<LinuxDbusProxy> {
  return bounded(new Promise((resolve, reject) => {
    bus.getService(PACKAGEKIT).getInterface(path, name, (error, proxy) => {
      if (error !== null && error !== undefined) { reject(new Error('PackageKit introspection failed', { cause: error })); return }
      if (proxy === undefined) { reject(new Error('PackageKit interface is absent')); return }
      resolve(proxy)
    })
  }), timeoutMs)
}

function method(proxy: LinuxDbusProxy, name: string, signature: string): (...args: unknown[]) => void {
  const signatures = proxy.$methods
  // Version-pinned SDK introspection metadata is checked so an older boolean ABI is not guessed.
  if (typeof signatures !== 'object' || signatures === null || !(name in signatures)
    || (signatures as Record<string, unknown>)[name] !== signature || typeof proxy[name] !== 'function') throw new Error(`Unsupported PackageKit method ${name}`)
  const invoke = proxy[name] as (...args: unknown[]) => void
  return (...args) => { Reflect.apply(invoke, proxy, args) }
}

async function closeBus(bus: LinuxDbusBus, timeoutMs: number): Promise<void> {
  if (bus.connection.stream.closed) return
  await bounded(new Promise<void>((resolve) => {
    bus.connection.stream.once('close', () => { resolve() })
    bus.connection.stream.destroy()
  }), timeoutMs)
}

function call(proxy: LinuxDbusProxy, name: string, signature: string, args: unknown[], timeoutMs: number): Promise<unknown> {
  return bounded(new Promise((resolve, reject) => {
    method(proxy, name, signature)(...args, (error: unknown, value: unknown) => {
      if (error !== undefined && error !== null) reject(new Error(`PackageKit ${name} failed`, { cause: error }))
      else resolve(value)
    })
  }), timeoutMs)
}

function verifyDebVersion(version: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('/usr/bin/dpkg-query', ['-W', '-f=${Status}\t${Architecture}\t${Version}', 'deepseek-harness'],
      { shell: false, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4096, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } },
      (error, stdout) => { resolve(error === null && stdout.trim() === `install ok installed\tamd64\t${version}`) })
  })
}

/**
 * Create a real PackageKit client over maintained introspected proxies; optional seams serve offline fixtures.
 * @param options - Connection deadline and optional offline proxy/verification seams.
 * @returns System PackageKit adapter using fixed socket and introspected method signatures.
 */
export function createLinuxPackageKitClient(options: {
  timeoutMs: number
  connect?: () => LinuxDbusBus
  verifyInstalled?: (version: string) => Promise<boolean>
}): LinuxPackageKitClient {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 60_000) throw new Error('Invalid PackageKit connection deadline')
  const connect = options.connect ?? connectSystemBus
  return {
    async available() {
      let bus: LinuxDbusBus | undefined
      const errors: unknown[] = []
      const onError = (error: unknown): void => { errors.push(error) }
      try {
        bus = connect(); bus.connection.on('error', onError)
        const root = await getProxy(bus, '/org/freedesktop/PackageKit', PACKAGEKIT, options.timeoutMs)
        method(root, 'CreateTransaction', '')
        return errors.length === 0
      } catch { return false }
      finally { if (bus !== undefined) await closeBus(bus, options.timeoutMs) }
    },
    async verifyInstalled(version) {
      return await (options.verifyInstalled ?? (async value => await verifyDebVersion(value, options.timeoutMs)))(version)
    },
    async createTransaction() {
      const bus = connect()
      let errorReason: string | undefined, closed = false, started = false
      const listeners = new Set<(event: LinuxPackageKitEvent) => void>()
      const emit = (event: LinuxPackageKitEvent): void => { if (!closed) for (const listener of listeners) listener(event) }
      const onError = (): void => { errorReason = 'PackageKit bus failed'; emit({ type: 'disconnected', reason: errorReason }) }
      const onEnd = (): void => { errorReason = 'PackageKit bus closed'; emit({ type: 'disconnected', reason: errorReason }) }
      bus.connection.on('error', onError); bus.connection.on('end', onEnd)
      const cleanup: Array<() => void> = []
      try {
        const root = await getProxy(bus, '/org/freedesktop/PackageKit', PACKAGEKIT, options.timeoutMs)
        const path = await call(root, 'CreateTransaction', '', [], options.timeoutMs)
        if (typeof path !== 'string' || !/^\/[A-Za-z0-9_/]+$/.test(path)) throw new Error('Invalid PackageKit transaction path')
        const proxy = await getProxy(bus, path, TRANSACTION, options.timeoutMs)
        const properties = await getProxy(bus, path, 'org.freedesktop.DBus.Properties', options.timeoutMs)
        method(proxy, 'InstallFiles', 'tas'); method(proxy, 'Cancel', ''); method(proxy, 'SetHints', 'as')
        const readAllowCancel = (): void => {
          const read = proxy.AllowCancel
          if (typeof read !== 'function') { emit({ type: 'disconnected', reason: 'PackageKit cancellation capability unavailable' }); return }
          const getAllowCancel = read as (callback: (error: unknown, allowed: unknown) => void) => void
          getAllowCancel((error: unknown, allowed: unknown) => {
            if (error !== null && error !== undefined || typeof allowed !== 'boolean') { emit({ type: 'disconnected', reason: 'PackageKit cancellation state unknown' }); return }
            emit({ type: 'allow-cancel', allowed })
          })
        }
        const finished = (outcome: unknown): void => {
          if (!Number.isInteger(outcome)) { emit({ type: 'disconnected', reason: 'Invalid PackageKit terminal event' }); return }
          emit({ type: 'finished', outcome: outcome === 1 ? 'success' : outcome === 3 ? 'cancelled' : 'failed' })
        }
        const failure = (_code: unknown, details: unknown): void => { emit({ type: 'error', reason: typeof details === 'string' ? details.slice(0, 1000) : 'PackageKit transaction failed' }) }
        const changed = (name: unknown): void => { if (name === TRANSACTION) readAllowCancel() }
        proxy.on('Finished', finished); proxy.on('ErrorCode', failure); proxy.on('Changed', readAllowCancel)
        properties.on('PropertiesChanged', changed)
        cleanup.push(() => { proxy.removeListener('Finished', finished); proxy.removeListener('ErrorCode', failure); proxy.removeListener('Changed', readAllowCancel); properties.removeListener('PropertiesChanged', changed) })
        await call(proxy, 'SetHints', 'as', [['interactive=true', 'background=false']], options.timeoutMs)
        if (errorReason !== undefined) throw new Error(errorReason)
        return {
          subscribe(listener) { listeners.add(listener); if (errorReason !== undefined) listener({ type: 'disconnected', reason: errorReason }); return () => { listeners.delete(listener) } },
          async installFile(filePath) {
            if (started || closed) throw new Error('PackageKit transaction already consumed')
            started = true; readAllowCancel()
            // Flags zero requests normal local-package authorization; no trust or auth policy is bypassed.
            await call(proxy, 'InstallFiles', 'tas', [0, [filePath]], options.timeoutMs)
          },
          async cancel() { if (closed) throw new Error('PackageKit transaction is closed'); await call(proxy, 'Cancel', '', [], options.timeoutMs) },
          async close() {
            if (closed) return
            closed = true; listeners.clear(); for (const dispose of cleanup) dispose()
            await closeBus(bus, options.timeoutMs)
          },
        }
      } catch (error) {
        closed = true; for (const dispose of cleanup) dispose(); await closeBus(bus, options.timeoutMs); throw error
      }
    },
  }
}

/**
 * Follow one already prepared system transaction without translating connection loss into cancellation.
 * @param transaction - Already prepared system transaction.
 * @param path - Verified package file path.
 * @param verifyInstalled - Exact dpkg version and architecture verification.
 * @param options - Transaction deadline and cancellation signal.
 * @returns System terminal outcome after closing the owned bus connection.
 */
export async function runLinuxDebTransaction(
  transaction: LinuxPackageKitTransaction,
  path: string,
  verifyInstalled: () => Promise<boolean>,
  options: { timeoutMs: number; signal: AbortSignal },
): Promise<LinuxInstallResult> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('Invalid PackageKit deadline')
  let allowCancel = false, errorReason: string | undefined, requested = false, cancelRequested = false
  let settle!: (result: LinuxInstallResult) => void
  const done = new Promise<LinuxInstallResult>((resolve) => { settle = resolve })
  const cancelled = (): void => {
    if (!requested) { settle({ status: 'cancelled' }); return }
    if (allowCancel && !cancelRequested) {
      cancelRequested = true
      void transaction.cancel().catch(() => { settle({ status: 'recovery-required', reason: 'System cancellation could not be confirmed' }) })
    }
  }
  const listener = (event: LinuxPackageKitEvent): void => {
    if (event.type === 'allow-cancel') { allowCancel = event.allowed; if (options.signal.aborted && allowCancel) cancelled(); return }
    if (event.type === 'error') { errorReason = event.reason; return }
    if (event.type === 'disconnected') { settle({ status: 'recovery-required', reason: event.reason }); return }
    if (event.outcome === 'cancelled') { settle({ status: 'cancelled' }); return }
    if (event.outcome !== 'success' || errorReason !== undefined) { settle({ status: 'recovery-required', reason: errorReason ?? 'System installation failed' }); return }
    void verifyInstalled().then((matches) => {
      settle(matches ? { status: 'system-transaction-complete' } : { status: 'recovery-required', reason: 'Installed package does not match the requested version' })
    }, () => { settle({ status: 'recovery-required', reason: 'Installed package verification failed' }) })
  }
  const unsubscribe = transaction.subscribe(listener)
  const timer = setTimeout(() => { settle({ status: 'recovery-required', reason: 'System transaction deadline exceeded; installation state unknown' }) }, options.timeoutMs)
  options.signal.addEventListener('abort', cancelled)
  try {
    if (options.signal.aborted) return { status: 'cancelled' }
    requested = true
    // Method acceptance is not completion; both rejection and daemon loss leave an uncertain transaction.
    void transaction.installFile(path).catch(() => { settle({ status: 'recovery-required', reason: 'System installation request could not be confirmed' }) })
    return await done
  } finally {
    clearTimeout(timer); options.signal.removeEventListener('abort', cancelled); unsubscribe(); await transaction.close()
  }
}
