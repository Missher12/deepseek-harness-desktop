import { vi, afterEach, describe, expect, it } from 'vitest'

const fake = vi.hoisted(() => {
  type Handler = (value?: unknown) => void
  class FakeWorker {
    static instances: FakeWorker[] = []
    static throwOnConstruction = false
    readonly handlers = new Map<string, Handler>()
    readonly stdout = { resume: vi.fn() }
    readonly stderr = { resume: vi.fn() }
    readonly terminate = vi.fn(() => Promise.resolve(1))

    constructor(readonly path: string, readonly options: Record<string, unknown>) {
      if (FakeWorker.throwOnConstruction) throw new Error('worker unavailable')
      FakeWorker.instances.push(this)
    }

    once(event: string, handler: Handler): this {
      this.handlers.set(event, handler)
      return this
    }

    emit(event: string, value?: unknown): void {
      this.handlers.get(event)?.(value)
      this.handlers.delete(event)
    }
  }
  return { FakeWorker }
})

vi.mock('node:worker_threads', () => ({ Worker: fake.FakeWorker }))

import { extractPdfIsolated } from '../src/pdf-isolate.ts'

const PDF = new TextEncoder().encode('%PDF-test')

function currentWorker(): InstanceType<typeof fake.FakeWorker> {
  const worker = fake.FakeWorker.instances.at(-1)
  if (worker === undefined) throw new Error('expected a worker')
  return worker
}

afterEach(() => {
  vi.useRealTimers()
  fake.FakeWorker.instances.length = 0
  fake.FakeWorker.throwOnConstruction = false
})

describe('PDF worker authority and settlement', () => {
  it('uses a hermetic bounded worker and accepts only a bounded exact result', async () => {
    const pending = extractPdfIsolated(PDF, 16)
    const worker = currentWorker()
    expect(worker.path).toMatch(/pdf-worker\.ts$/u)
    expect(worker.options).toMatchObject({
      execArgv: [],
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: 128 },
      stdout: true,
      stderr: true,
    })
    expect(worker.stdout.resume).toHaveBeenCalledOnce()
    expect(worker.stderr.resume).toHaveBeenCalledOnce()
    worker.emit('message', { ok: true, text: 'bounded', truncated: false })
    await expect(pending).resolves.toEqual({ text: 'bounded', truncated: false })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it.each([
    null,
    Object.create(null),
    { ok: false },
    { ok: true, text: 1, truncated: false },
    { ok: true, text: 'x', truncated: 'no' },
    { ok: true, text: 'too long', truncated: false },
  ])('rejects a malformed or over-budget worker result %#', async (result) => {
    const pending = extractPdfIsolated(PDF, 4)
    currentWorker().emit('message', result)
    await expect(pending).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
  })

  it.each(['error', 'exit'])('fails closed when the worker emits %s', async (event) => {
    const pending = extractPdfIsolated(PDF, 16)
    currentWorker().emit(event, event === 'exit' ? 1 : new Error('worker failed'))
    await expect(pending).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
  })

  it('keeps the first terminal event and rejects a termination failure', async () => {
    const pending = extractPdfIsolated(PDF, 16)
    const worker = currentWorker()
    worker.terminate.mockRejectedValueOnce(new Error('terminate failed'))
    worker.emit('message', { ok: true, text: 'ok', truncated: false })
    worker.emit('error', new Error('late error'))
    await expect(pending).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
  })

  it('times out a silent worker and waits for termination', async () => {
    vi.useFakeTimers()
    const pending = extractPdfIsolated(PDF, 16)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
    await vi.advanceTimersByTimeAsync(30_000)
    await rejected
    expect(currentWorker().terminate).toHaveBeenCalledOnce()
  })

  it('maps construction failure and invalid direct inputs without leaking runtime errors', async () => {
    await expect(extractPdfIsolated(new TextEncoder().encode('not pdf'), 16))
      .rejects.toMatchObject({ code: 'DOCUMENT_TYPE_MISMATCH' })
    await expect(extractPdfIsolated(PDF, 0)).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
    fake.FakeWorker.throwOnConstruction = true
    await expect(extractPdfIsolated(PDF, 16)).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
  })
})
