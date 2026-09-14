import { describe, expect, it } from 'vitest'
import { createLinuxPackageKitClient, runLinuxDebTransaction } from '../src/update/linux-deb-transaction.ts'
import type { LinuxDbusBus, LinuxDbusProxy, LinuxPackageKitEvent, LinuxPackageKitTransaction } from '../src/update/linux-update-protocol.ts'
import { EventEmitter } from 'node:events'
import { Socket } from 'node:net'

describe('PackageKit installation outcomes', () => {
  it('waits for the real transaction terminal event and installed package verification', async () => {
    const events: LinuxPackageKitEvent[] = [{ type: 'finished', outcome: 'success' }]
    let installs = 0, closed = false
    const transaction: LinuxPackageKitTransaction = {
      subscribe(listener) { queueMicrotask(() => { for (const event of events) listener(event) }); return () => {} },
      async installFile() { installs += 1 }, async cancel() {}, async close() { closed = true },
    }
    const result = await runLinuxDebTransaction(transaction, '/verified/update.deb', async () => true, { timeoutMs: 1000, signal: new AbortController().signal })
    expect(result.status).toBe('system-transaction-complete')
    expect(installs).toBe(1)
    expect(closed).toBe(true)
  })

  it('does not declare success from method acceptance or a mismatched installed version', async () => {
    const transaction: LinuxPackageKitTransaction = {
      subscribe(listener) { queueMicrotask(() => { listener({ type: 'finished', outcome: 'success' }) }); return () => {} },
      async installFile() {}, async cancel() {}, async close() {},
    }
    const result = await runLinuxDebTransaction(transaction, '/verified/update.deb', async () => false, { timeoutMs: 1000, signal: new AbortController().signal })
    expect(result.status).toBe('recovery-required')
  })

  it('does not issue a system request after pre-commit cancellation', async () => {
    const abort = new AbortController(); abort.abort()
    let installed = false, closed = false
    const transaction: LinuxPackageKitTransaction = {
      subscribe() { return () => {} }, async installFile() { installed = true }, async cancel() {}, async close() { closed = true },
    }
    expect(await runLinuxDebTransaction(transaction, '/verified/update.deb', async () => true, { timeoutMs: 1000, signal: abort.signal })).toEqual({ status: 'cancelled' })
    expect(installed).toBe(false); expect(closed).toBe(true)
  })

  it('waits for system cancellation and never kills an uninterruptible transaction', async () => {
    const abort = new AbortController()
    let listener!: (event: LinuxPackageKitEvent) => void
    let cancelCount = 0
    const transaction: LinuxPackageKitTransaction = {
      subscribe(value) { listener = value; return () => {} },
      async installFile() {
        listener({ type: 'allow-cancel', allowed: false }); abort.abort()
        expect(cancelCount).toBe(0)
        listener({ type: 'allow-cancel', allowed: true })
      },
      async cancel() { cancelCount += 1; listener({ type: 'finished', outcome: 'cancelled' }) },
      async close() {},
    }
    expect(await runLinuxDebTransaction(transaction, '/verified/update.deb', async () => false, { timeoutMs: 1000, signal: abort.signal })).toEqual({ status: 'cancelled' })
    expect(cancelCount).toBe(1)
  })

  it('does not replay a request after a connection loss', async () => {
    let listener!: (event: LinuxPackageKitEvent) => void
    let installs = 0
    const transaction: LinuxPackageKitTransaction = {
      subscribe(value) { listener = value; return () => {} },
      async installFile() { installs += 1; listener({ type: 'disconnected', reason: 'bus lost' }) },
      async cancel() {}, async close() {},
    }
    expect((await runLinuxDebTransaction(transaction, '/verified/update.deb', async () => true, { timeoutMs: 1000, signal: new AbortController().signal })).status).toBe('recovery-required')
    expect(installs).toBe(1)
  })

  it('uses introspected PackageKit proxies, native numeric results and a closed client socket', async () => {
    const connection = Object.assign(new EventEmitter(), { stream: new Socket() })
    const transaction = Object.assign(new EventEmitter(), {
      $methods: { InstallFiles: 'tas', SetHints: 'as', Cancel: '' },
      SetHints(this: { $methods: unknown }, hints: string[], callback: (error: unknown) => void) {
        expect(this.$methods).toBeDefined(); expect(hints).toContain('interactive=true'); callback(null)
      },
      InstallFiles(flags: number, paths: string[], callback: (error: unknown) => void) {
        expect(flags).toBe(0); expect(paths).toEqual(['/verified/update.deb'])
        callback(null); queueMicrotask(() => { transaction.emit('Finished', 1, 0) })
      },
      Cancel(callback: (error: unknown) => void) { callback(null) },
      AllowCancel(callback: (error: unknown, value: unknown) => void) { callback(null, true) },
    })
    const root = Object.assign(new EventEmitter(), { $methods: { CreateTransaction: '' }, CreateTransaction(callback: (error: unknown, path: string) => void) { callback(null, '/42_abcd') } })
    const properties = new EventEmitter()
    const bus: LinuxDbusBus = {
      connection,
      getService(name) {
        expect(name).toBe('org.freedesktop.PackageKit')
        return { getInterface(path, iface, callback) {
          const proxy = path === '/org/freedesktop/PackageKit' ? root : iface.endsWith('.Properties') ? properties : transaction
          callback(null, proxy as unknown as LinuxDbusProxy)
        } }
      },
    }
    const client = createLinuxPackageKitClient({ connect: () => bus, timeoutMs: 1000, verifyInstalled: async version => version === '0.6.0' })
    const prepared = await client.createTransaction()
    const result = await runLinuxDebTransaction(prepared, '/verified/update.deb', async () => await client.verifyInstalled('0.6.0'), { timeoutMs: 1000, signal: new AbortController().signal })
    expect(result.status).toBe('system-transaction-complete')
    expect(connection.stream.closed).toBe(true)
    expect(transaction.listenerCount('Finished')).toBe(0)
    expect(properties.listenerCount('PropertiesChanged')).toBe(0)
  })
})
