import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Windows Computer Use platform adapter', () => {
  it('has a dedicated Windows platform module', () => {
    const moduleUrl = new URL(
      '../native/computer-use-helper/crates/helper/src/platform/windows/mod.rs',
      import.meta.url,
    )

    expect(existsSync(moduleUrl)).toBe(true)
  })

  it('keeps each Windows trust boundary in a dedicated module', () => {
    const moduleRoot = new URL(
      '../native/computer-use-helper/crates/helper/src/platform/windows/',
      import.meta.url,
    )
    const modules = [
      'capture.rs',
      'composition.rs',
      'identity.rs',
      'input.rs',
      'permissions.rs',
      'scale.rs',
      'uia.rs',
    ]

    expect(modules.filter(name => !existsSync(new URL(name, moduleRoot)))).toEqual([])
    expect(readFileSync(new URL('mod.rs', moduleRoot), 'utf8')).toMatch(
      /mod capture;[\s\S]*mod composition;[\s\S]*mod identity;[\s\S]*mod input;[\s\S]*mod permissions;[\s\S]*mod scale;[\s\S]*mod uia;/,
    )
  })

  it('compiles portable Windows policy tests on Mac and selects the adapter only on Windows', () => {
    const platformSource = readFileSync(new URL(
      '../native/computer-use-helper/crates/helper/src/platform/mod.rs',
      import.meta.url,
    ), 'utf8')
    const mainSource = readFileSync(new URL(
      '../native/computer-use-helper/crates/helper/src/main.rs',
      import.meta.url,
    ), 'utf8')

    expect(platformSource).toContain('#[cfg(any(test, target_os = "windows"))]\npub mod windows;')
    expect(mainSource).toContain('#[cfg(target_os = "windows")]\nuse computer_use_helper::platform::windows::observation_platform;')
    expect(mainSource).toContain('#[cfg(not(any(target_os = "macos", target_os = "windows")))]')
  })

  it('wires closed portable contracts to bounded native Windows calls', () => {
    const moduleRoot = new URL(
      '../native/computer-use-helper/crates/helper/src/platform/windows/',
      import.meta.url,
    )
    const source = (name: string): string => readFileSync(new URL(name, moduleRoot), 'utf8')

    expect(source('identity.rs')).toContain('pub(crate) struct WindowIdentity')
    expect(source('scale.rs')).toContain('pub(crate) struct VirtualDesktop')
    expect(source('permissions.rs')).toContain('pub(crate) struct PermissionSnapshot')
    expect(source('uia.rs')).toContain('pub(crate) struct RawUiaNode')
    expect(source('capture.rs')).toContain('pub(crate) struct CapturedFrame')
    expect(source('input.rs')).toContain('pub(crate) struct ReleaseJournal')
    expect(source('composition.rs')).toContain('pub(crate) trait WindowsApi')
    expect(source('identity.rs')).toContain('fn matches(')
    expect(source('scale.rs')).toContain('fn normalize_for_send_input(')
    expect(source('permissions.rs')).toContain('fn authorize_input(')
    expect(source('uia.rs')).toContain('fn project_semantics(')
    expect(source('capture.rs')).toContain('fn encode_bounded_png(')
    expect(source('capture.rs')).toContain('max_pixels: usize')
    expect(source('capture.rs')).toContain('max_png_bytes: usize')
    expect(source('input.rs')).toContain('fn confirm_release(')
    expect(source('composition.rs')).toContain('pub(crate) struct PlatformStatus')
    expect(source('composition.rs')).toContain('pub(crate) struct WindowTarget')
    expect(source('composition.rs')).toContain('pub(crate) struct ObservedUia')
    expect(source('composition.rs')).toContain('pub(crate) struct PreparedSnapshot')
    expect(source('composition.rs')).toContain('fn prepare_snapshot(')
    expect(source('input.rs')).toContain('pub(crate) struct ClosedInputPlan')
    expect(source('input.rs')).toContain('pub(crate) trait SendInputSink')
    expect(source('identity.rs')).toContain('pub(crate) fn query_window_identity')
    expect(source('permissions.rs')).toContain('pub(crate) fn native_permission_snapshot')
    expect(source('uia.rs')).toContain('pub(crate) fn observe_exact_window')
    expect(source('capture.rs')).toContain('pub(crate) fn capture_exact_window')
    expect(source('capture.rs')).toContain('Direct3D11CaptureFramePool::CreateFreeThreaded')
    expect(source('input.rs')).toContain('SendInput(')
    expect(source('composition.rs')).toContain('input.execute(&plan, &mut validate, permit)')
    expect(source('composition.rs')).toContain('fn validate_live<')
  })
})
