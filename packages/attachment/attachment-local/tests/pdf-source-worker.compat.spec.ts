import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

async function sourceWorkerWithoutWorkspaceBuild(): Promise<unknown> {
  const root = await mkdtemp(join(packageRoot, '.pdf-source-worker-'))
  temporaryRoots.push(root)
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  for (const name of ['pdf-worker.ts', 'pdf-extraction.ts', 'pdf-protocol.ts', 'text-budget.ts']) {
    await writeFile(join(root, name), await readFile(join(packageRoot, 'src', name)))
  }
  const shadowPackage = join(root, 'node_modules', '@deepseek-ai', 'dsh-attachment')
  await mkdir(shadowPackage, { recursive: true })
  await writeFile(join(shadowPackage, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-attachment',
    type: 'module',
    exports: './missing-workspace-build.js',
  }))

  const worker = new Worker(join(root, 'pdf-worker.ts'), {
    workerData: { data: new Uint8Array(), maxBytes: 1 },
    execArgv: [],
  })
  try {
    return await new Promise((resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.once('exit', (code) => {
        if (code !== 0) reject(new Error(`source PDF worker exited with ${String(code)}`))
      })
    })
  } finally {
    await worker.terminate()
  }
}

describe('source PDF worker closure', () => {
  it('starts without any built workspace package', async () => {
    await expect(sourceWorkerWithoutWorkspaceBuild()).resolves.toEqual({ ok: false })
  })
})
