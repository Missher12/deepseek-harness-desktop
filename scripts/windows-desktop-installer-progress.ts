import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

/** Portable result of observing a real, visible NSIS installation. */
export interface InstallerProgressEvidence {
  schemaVersion: 1
  outcome: 'passed' | 'expected-blank-details'
  sampleCount: number
  detailSampleCount: number
  distinctPositions: number
  durationMs: number
}

class InstallerProgressError extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedInteger(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

/**
 * Validate native observations taken before the NSIS finish page appears.
 * @param value - Bounded observations supplied by the Windows UI smoke.
 * @param expectBlankDetails - Require the historical empty-details regression.
 * @returns Portable evidence without control text or machine paths.
 */
export function summarizeInstallerProgress(value: unknown, expectBlankDetails = false): InstallerProgressEvidence {
  if (!record(value) || !exactKeys(value, ['schemaVersion', 'samples', 'finishedElapsedMs'])
    || value.schemaVersion !== 1 || !boundedInteger(value.finishedElapsedMs, 180_000)
    || !Array.isArray(value.samples) || value.samples.length < 2 || value.samples.length > 3600) {
    throw new InstallerProgressError('invalid installer observations')
  }
  const samples: unknown[] = value.samples
  let previousTime = -1
  let lastControlsTime = 0
  let lastDetailsTime = 0
  let detailSampleCount = 0
  let populatedLists = 0
  const ranges = new Map<string, Set<number>>()
  const detailedRanges = new Map<string, Set<number>>()
  for (const sample of samples) {
    if (!record(sample) || !boundedInteger(sample.elapsedMs, 180_000)) {
      throw new InstallerProgressError('invalid installer observation')
    }
    if (sample.elapsedMs >= value.finishedElapsedMs) {
      throw new InstallerProgressError('observation is not before completion')
    }
    if (sample.elapsedMs <= previousTime) throw new InstallerProgressError('non-increasing observation time')
    previousTime = sample.elapsedMs
    // Allow short native page/control transitions, but never hide a slow blank
    // phase by dropping missing controls or stopping collection before Finish.
    if (sample.elapsedMs - lastControlsTime > 5000) {
      throw new InstallerProgressError('native installation controls were unavailable too long')
    }
    if (!expectBlankDetails && sample.elapsedMs - lastDetailsTime > 5000) {
      throw new InstallerProgressError('installation details were unavailable too long')
    }
    if (exactKeys(sample, ['elapsedMs', 'missing']) && sample.missing === true) continue
    if (!exactKeys(sample, ['elapsedMs', 'minimum', 'maximum', 'position', 'detailsRows', 'statusPresent'])
      || !boundedInteger(sample.minimum, 2_147_483_647)
      || !boundedInteger(sample.maximum, 2_147_483_647)
      || sample.minimum >= sample.maximum
      || !boundedInteger(sample.position, sample.maximum) || sample.position < sample.minimum
      || !boundedInteger(sample.detailsRows, 1_000_000) || typeof sample.statusPresent !== 'boolean') {
      throw new InstallerProgressError('invalid installer observation')
    }
    lastControlsTime = sample.elapsedMs
    if (sample.detailsRows > 0 && sample.statusPresent) lastDetailsTime = sample.elapsedMs
    // NSIS and the decompressor may use separate ranges or reset progress.
    // Require movement inside one real range, not a timer or range change.
    if (sample.position < sample.maximum) {
      const key = `${String(sample.minimum)}:${String(sample.maximum)}`
      const positions = ranges.get(key) ?? new Set<number>()
      positions.add(sample.position)
      ranges.set(key, positions)
      if (sample.detailsRows > 0) {
        populatedLists += 1
        if (sample.statusPresent) {
          detailSampleCount += 1
          const detailedPositions = detailedRanges.get(key) ?? new Set<number>()
          detailedPositions.add(sample.position)
          detailedRanges.set(key, detailedPositions)
        }
      }
    }
  }
  if (value.finishedElapsedMs - lastControlsTime > 5000) {
    throw new InstallerProgressError('native installation controls were unavailable too long')
  }
  if (!expectBlankDetails && value.finishedElapsedMs - lastDetailsTime > 5000) {
    throw new InstallerProgressError('installation details were unavailable too long')
  }
  const distinctPositions = Math.max(0, ...[...ranges.values()].map(positions => positions.size))
  if (distinctPositions < 2) throw new InstallerProgressError('native progress did not change')
  if (expectBlankDetails) {
    if (populatedLists !== 0) {
      throw new InstallerProgressError('baseline unexpectedly populated installation details')
    }
  } else if (![...detailedRanges.values()].some(positions => positions.size >= 2)) {
    throw new InstallerProgressError('installation details stayed empty')
  }
  return {
    schemaVersion: 1,
    outcome: expectBlankDetails ? 'expected-blank-details' : 'passed',
    sampleCount: samples.length,
    detailSampleCount,
    distinctPositions,
    durationMs: value.finishedElapsedMs,
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { input: { type: 'string' }, output: { type: 'string' }, 'expect-blank-details': { type: 'boolean' } },
    allowPositionals: false,
  })
  if (values.input === undefined || values.output === undefined) {
    throw new InstallerProgressError('installer progress requires --input and --output')
  }
  const input = await lstat(values.input)
  if (!input.isFile() || input.size > 512 * 1024) throw new InstallerProgressError('invalid installer observations file')
  const observed: unknown = JSON.parse(await readFile(values.input, 'utf8'))
  const evidence = summarizeInstallerProgress(observed, values['expect-blank-details'] === true)
  await mkdir(dirname(values.output), { recursive: true })
  await writeFile(values.output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  console.log(`Native installer progress: ${evidence.outcome}; ${String(evidence.distinctPositions)} positions; ${String(evidence.detailSampleCount)} detail samples.`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof InstallerProgressError ? error.message : 'Could not read or write installer progress evidence.')
    process.exitCode = 1
  })
}
