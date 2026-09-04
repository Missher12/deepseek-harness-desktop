import {
  chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile,
} from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPackagedDesktopSmoke } from './packaged-smoke.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const releaseRoot = join(repositoryRoot, 'apps', 'desktop', 'release')
const realExecutable = process.env.DSH_MACOS_DESKTOP_EXECUTABLE
const evidenceRoot = process.env.DSH_MACOS_VISUAL_EVIDENCE_ROOT
const SCALE_PERCENTAGES = [100, 150] as const

function shellQuote(value: string): string {
  const quote = String.fromCodePoint(39)
  return `${quote}${value.replaceAll(quote, `${quote}"${quote}"${quote}`)}${quote}`
}

async function createScaledExecutable(root: string, scalePercent: number): Promise<string> {
  if (realExecutable === undefined) throw new Error('Mac visual smoke executable is missing')
  const wrapperApp = join(root, `DeepSeek Harness Visual ${String(scalePercent)}.app`)
  const macos = join(wrapperApp, 'Contents', 'MacOS')
  await mkdir(macos, { recursive: true })
  await symlink(
    resolve(dirname(realExecutable), '..', 'Resources'),
    join(wrapperApp, 'Contents', 'Resources'),
    'dir',
  )
  const wrapper = join(macos, 'DeepSeek Harness')
  const scaleFactor = scalePercent / 100
  await writeFile(wrapper, [
    '#!/bin/sh',
    `exec ${shellQuote(realExecutable)} --force-device-scale-factor=${String(scaleFactor)} "$@"`,
    '',
  ].join('\n'), 'utf8')
  await chmod(wrapper, 0o755)
  return wrapper
}

function pngDimensions(content: Buffer): { width: number; height: number } {
  const signature = content.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a' || content.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('Mac visual smoke did not produce a PNG')
  }
  return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) }
}

async function retainBoundedVisualEvidence(scalePercent: number): Promise<void> {
  if (evidenceRoot === undefined) throw new Error('Mac visual smoke evidence root is missing')
  await mkdir(evidenceRoot, { recursive: true })
  const names = (await readdir(releaseRoot)).filter(name => (
    /^desktop-smoke-.*-darwin\.(?:json|png)$/u.test(name)
  ))
  for (const name of names) {
    const extension = extname(name)
    const target = `${name.slice(0, -extension.length)}-${String(scalePercent)}${extension}`
    await copyFile(join(releaseRoot, name), join(evidenceRoot, target))
  }

  const titlebar = join(releaseRoot, 'desktop-smoke-titlebar-darwin.png')
  const dimensions = pngDimensions(await readFile(titlebar))
  const scaleFactor = scalePercent / 100
  expect(dimensions).toEqual({
    width: Math.round(1_600 * scaleFactor),
    height: Math.round(1_000 * scaleFactor),
  })
  await writeFile(join(evidenceRoot, `native-visual-${String(scalePercent)}.json`), `${JSON.stringify({
    schemaVersion: 1,
    platform: 'darwin-x64',
    scalePercent,
    scaleMode: 'electron-force-device-scale-factor',
    titlebarPixels: dimensions,
    sharedFeatureSmoke: 'passed',
    processTreeRemaining: 0,
    openDesignProfile: 'isolated-fixture-detected',
  }, null, 2)}\n`, 'utf8')
}

describe.skipIf(
  process.platform !== 'darwin'
  || realExecutable === undefined
  || evidenceRoot === undefined
  || !existsSync(realExecutable),
)('packaged DeepSeek Harness native macOS visuals', () => {
  for (const scalePercent of SCALE_PERCENTAGES) {
    it(`runs the complete packaged feature smoke at ${String(scalePercent)} percent`, async () => {
      // The shared smoke is the one product contract for titlebar, Turn rail,
      // @/+, Workbench, BrowserSkill, Memory & Learning, close/Quit, upgrade
      // recovery, data preservation, and zero remaining process/listener state.
      // Keep Open Design independent: that helper seeds only an isolated
      // profile marker and requires data-open-design-state="installed".
      const sharedSmoke = readFileSync(new URL('./packaged-smoke.ts', import.meta.url), 'utf8')
      expect(sharedSmoke).toContain('data-open-design-state="installed"')
      expect(sharedSmoke).toContain('data-browser-skill-idle')

      const temporaryRoot = await mkdtemp(join(tmpdir(), `dsh-macos-visual-${String(scalePercent)}-`))
      const wrapper = await createScaledExecutable(temporaryRoot, scalePercent)
      const previousRoot = process.env.DSH_DESKTOP_SMOKE_ROOT
      const previousHome = process.env.DSH_DESKTOP_SMOKE_DSH_HOME
      const previousUserData = process.env.DSH_DESKTOP_SMOKE_USER_DATA
      process.env.DSH_DESKTOP_SMOKE_ROOT = join(temporaryRoot, 'smoke')
      process.env.DSH_DESKTOP_SMOKE_DSH_HOME = join(temporaryRoot, 'smoke', 'dsh-home')
      process.env.DSH_DESKTOP_SMOKE_USER_DATA = join(temporaryRoot, 'smoke', 'electron-data')
      try {
        await runPackagedDesktopSmoke(wrapper, 'darwin')
        await retainBoundedVisualEvidence(scalePercent)
      } finally {
        if (previousRoot === undefined) delete process.env.DSH_DESKTOP_SMOKE_ROOT
        else process.env.DSH_DESKTOP_SMOKE_ROOT = previousRoot
        if (previousHome === undefined) delete process.env.DSH_DESKTOP_SMOKE_DSH_HOME
        else process.env.DSH_DESKTOP_SMOKE_DSH_HOME = previousHome
        if (previousUserData === undefined) delete process.env.DSH_DESKTOP_SMOKE_USER_DATA
        else process.env.DSH_DESKTOP_SMOKE_USER_DATA = previousUserData
        await rm(temporaryRoot, { recursive: true, force: true })
      }
    }, 300_000)
  }
})
