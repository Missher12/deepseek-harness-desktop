import { describe, expect, it } from 'vitest'
import { resolveInstallationAnchor, resolveTelemetryPatch } from '../src/profile-boot.ts'

describe('resolveInstallationAnchor', () => {
  it('uses the Electron application manifest for a CLI packaged inside app.asar', () => {
    expect(resolveInstallationAnchor(
      '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/node_modules/@deepseek-ai/dsh/package.json',
    )).toBe('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/package.json')
    expect(resolveInstallationAnchor(
      String.raw`C:\Program Files\DeepSeek Harness\resources\app.asar\node_modules\@deepseek-ai\dsh\package.json`,
    )).toBe(String.raw`C:\Program Files\DeepSeek Harness\resources\app.asar\package.json`)
  })

  it('keeps a standalone CLI package manifest as its own installation root', () => {
    expect(resolveInstallationAnchor('/opt/dsh/node_modules/@deepseek-ai/dsh/package.json'))
      .toBe('/opt/dsh/node_modules/@deepseek-ai/dsh/package.json')
  })
})

describe('resolveTelemetryPatch', () => {
  it('preserves the configured telemetry mode when the hard-disable switch is unset or empty', () => {
    expect(resolveTelemetryPatch(undefined, true)).toBeUndefined()
    expect(resolveTelemetryPatch('', true)).toBeUndefined()
  })

  it('disables on ANY non-empty value, including falsy-looking ones', () => {
    for (const value of ['1', '0', 'false', 'no']) {
      expect(resolveTelemetryPatch(value, true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
    }
  })

  it('is trivially satisfied by a composition without the telemetry row', () => {
    // A custom profile need not mount telemetry: nothing exports, so the
    // privacy switch has nothing to disable and generates no patch.
    expect(resolveTelemetryPatch('1', false)).toBeUndefined()
    expect(resolveTelemetryPatch(undefined, false)).toBeUndefined()
  })
})
