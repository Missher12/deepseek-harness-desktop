import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Fixed Desktop startup milestones accepted by benchmark evidence. */
export const DESKTOP_STARTUP_MILESTONES = [
  'app-ready',
  'window-prerequisites',
  'loading-visible',
  'fallback-ready',
  'url-reported',
  'harness-ready',
  'desktop-running',
] as const

/** One successful Desktop launch represented only by fixed elapsed times. */
export type DesktopStartupSample = Record<typeof DESKTOP_STARTUP_MILESTONES[number], number>

interface DurationSummary {
  medianMs: number
  p95Ms: number
}

/** Aggregate evidence for exactly five comparable Desktop launches. */
export interface DesktopStartupSummary {
  schemaVersion: 1
  sampleCount: 5
  total: DurationSummary
  fallbackToUrl: DurationSummary
  urlToHarnessReady: DurationSummary
  harnessReadyToDesktop: DurationSummary
  milestones: Record<typeof DESKTOP_STARTUP_MILESTONES[number], DurationSummary>
}

const MILESTONE_SET = new Set<string>(DESKTOP_STARTUP_MILESTONES)
const CAUSAL_CHAINS: readonly (readonly (keyof DesktopStartupSample)[])[] = [
  ['app-ready', 'window-prerequisites', 'loading-visible', 'desktop-running'],
  ['app-ready', 'fallback-ready', 'url-reported', 'harness-ready', 'desktop-running'],
]

function fail(reason: string): never {
  throw new Error(`Desktop startup benchmark: ${reason}`)
}

/**
 * Parse one successful lifecycle log without retaining unrelated log content.
 * @param content - Complete lifecycle log text for one isolated launch.
 * @returns Fixed non-sensitive milestone durations.
 */
export function parseDesktopStartupSample(content: string): DesktopStartupSample {
  const values = new Map<string, number>()
  for (const line of content.split(/\r?\n/u)) {
    const envelope = /^(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z )?(startup .*)$/u.exec(line)
    if (envelope === null) continue
    const message = envelope[1]
    if (message === undefined) continue
    const match = /^startup ([a-z-]+): ([0-9]+)ms$/u.exec(message)
    if (match === null) fail('found a malformed startup line')
    const [, milestone, rawDuration] = match
    if (milestone === undefined || rawDuration === undefined || !MILESTONE_SET.has(milestone)) {
      fail('found an unknown milestone')
    }
    if (values.has(milestone)) fail(`found duplicate milestone ${milestone}`)
    const duration = Number(rawDuration)
    if (!Number.isSafeInteger(duration) || duration < 0) fail(`found invalid duration for ${milestone}`)
    values.set(milestone, duration)
  }

  for (const milestone of DESKTOP_STARTUP_MILESTONES) {
    if (!values.has(milestone)) fail(`missing milestone ${milestone}`)
  }
  const sample = Object.fromEntries(values) as DesktopStartupSample
  for (const chain of CAUSAL_CHAINS) {
    for (let index = 1; index < chain.length; index += 1) {
      const previous = chain[index - 1]
      const current = chain[index]
      if (previous === undefined || current === undefined) continue
      if (sample[current] < sample[previous]) fail(`milestone ${current} precedes ${previous}`)
    }
  }
  return sample
}

function summarizeDurations(values: readonly number[]): DurationSummary {
  const ordered = [...values].sort((left, right) => left - right)
  const median = ordered[Math.floor(ordered.length / 2)]
  const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1]
  if (median === undefined || p95 === undefined) fail('cannot summarize an empty sample')
  return { medianMs: median, p95Ms: p95 }
}

/**
 * Summarize exactly five comparable launches with total and critical phase deltas.
 * @param samples - Five parsed cold or warm startup samples from one fixture.
 * @returns Reproducible median and nearest-rank P95 evidence.
 */
export function summarizeDesktopStartupSamples(
  samples: readonly DesktopStartupSample[],
): DesktopStartupSummary {
  if (samples.length !== 5) fail('summary requires exactly five samples')
  const milestoneSummaries = Object.fromEntries(DESKTOP_STARTUP_MILESTONES.map(milestone => [
    milestone,
    summarizeDurations(samples.map(sample => sample[milestone])),
  ])) as DesktopStartupSummary['milestones']
  return {
    schemaVersion: 1,
    sampleCount: 5,
    total: summarizeDurations(samples.map(sample => sample['desktop-running'])),
    fallbackToUrl: summarizeDurations(samples.map(sample => sample['url-reported'] - sample['fallback-ready'])),
    urlToHarnessReady: summarizeDurations(samples.map(sample => sample['harness-ready'] - sample['url-reported'])),
    harnessReadyToDesktop: summarizeDurations(samples.map(sample => sample['desktop-running'] - sample['harness-ready'])),
    milestones: milestoneSummaries,
  }
}

async function main(args: readonly string[]): Promise<void> {
  const outputIndex = args.indexOf('--output')
  if (outputIndex < 0 || outputIndex === args.length - 1) fail('usage: --output <summary.json> <five log files>')
  const output = args[outputIndex + 1]
  const logs = args.filter((_value, index) => index !== outputIndex && index !== outputIndex + 1)
  if (output === undefined || logs.length !== 5) fail('usage: --output <summary.json> <five log files>')
  const samples = await Promise.all(logs.map(async path => parseDesktopStartupSample(await readFile(path, 'utf8'))))
  await writeFile(output, `${JSON.stringify(summarizeDesktopStartupSamples(samples), null, 2)}\n`, 'utf8')
  process.stdout.write('desktop startup benchmark: recorded five samples\n')
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
