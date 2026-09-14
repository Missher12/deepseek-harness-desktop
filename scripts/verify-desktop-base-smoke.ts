/** Read-only native acceptance gate with an explicit full or core result. */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyPackagedDesktopBaseSmokeReceipt } from '../apps/desktop/tests/base-smoke-receipt.ts'

/**
 * Verify a complete native base receipt against the explicit platform and stage descriptor.
 * @param args Command-line arguments with receipt, descriptor, isolation root and platform.
 * @returns Explicit scope, outcome and unverified recovery list after installed bytes, history and cleanup pass.
 */
export async function verifyDesktopBaseSmoke(args: readonly string[]): Promise<{
  scope: 'full' | 'core'
  outcome: 'passed' | 'core-passed'
  unverifiedChecks: 'pauseRecovery'[]
}> {
  const options = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1]
    if (key === undefined || !['--receipt', '--descriptor', '--smoke-root', '--platform', '--scope'].includes(key)
      || value === undefined || value.startsWith('--') || options.has(key)) throw new Error('Invalid native base verification arguments.')
    options.set(key, value)
  }
  const receipt = options.get('--receipt'), descriptor = options.get('--descriptor'), root = options.get('--smoke-root')
  const platform = options.get('--platform')
  const scope = options.get('--scope') ?? 'full'
  if (receipt === undefined || descriptor === undefined || root === undefined
    || (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux') || (scope !== 'full' && scope !== 'core')) {
    throw new Error('Explicit native verification inputs and a known scope are required.')
  }
  const verified = await verifyPackagedDesktopBaseSmokeReceipt(resolve(receipt), {
    platform, descriptorPath: resolve(descriptor), smokeRoot: resolve(root), scope,
  })
  if (verified.outcome === 'partial') throw new Error('Native verification remains incomplete.')
  return { scope, outcome: verified.outcome, unverifiedChecks: verified.checks.pauseRecovery?.status === 'not-run' ? ['pauseRecovery'] : [] }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void verifyDesktopBaseSmoke(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Native base verification failed.'}\n`)
    process.exitCode = 1
  })
}
