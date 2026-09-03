import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDirectory = fileURLToPath(new URL('..', import.meta.url))
const workerPath = join(packageDirectory, 'lib/pdf-worker.cjs')

describe.skipIf(!existsSync(workerPath))('built PDF worker', () => {
  it('loads the shipped CommonJS worker without Host loader hooks', async () => {
    const data = new TextEncoder().encode('%PDF-invalid')
    const worker = new Worker(workerPath, {
      workerData: { data, maxBytes: 1024 },
      transferList: [data.buffer],
      execArgv: [],
      env: {},
      stdout: true,
      stderr: true,
    })
    worker.stdout.resume()
    worker.stderr.resume()
    const response = await new Promise<unknown>((resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
    })
    expect(response).toEqual({ ok: false })
    await worker.terminate()
  })
})
