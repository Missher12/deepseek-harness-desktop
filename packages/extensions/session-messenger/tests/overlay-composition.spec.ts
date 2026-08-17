import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const WEB_PATCH = join(REPO_ROOT, 'packages/bundle/web-app/cordis.patch.yml')
const DESKTOP_PATCH = join(REPO_ROOT, 'apps/desktop/desktop.cordis.patch.yml')
const PACKAGE_NAME = '@deepseek-ai/dsh-session-messenger'

describe('shipped profile composition', () => {
  it('keeps ordinary Web messenger-free and mounts exactly one canonical Desktop row', () => {
    const base = loadOverlayPatches('session-messenger composition', BASE_PATCH)
    const web = loadOverlayPatches('session-messenger composition', WEB_PATCH)
    const desktop = loadOverlayPatches('session-messenger composition', DESKTOP_PATCH)
    const ordinary = composeEntries([base, web])
    const desktopRows = composeEntries([base, web, desktop])

    expect(ordinary.filter(row => row.id === 'session-messenger' || row.name === PACKAGE_NAME)).toEqual([])
    expect(desktopRows.filter(row => row.id === 'session-messenger' || row.name === PACKAGE_NAME))
      .toEqual([{ id: 'session-messenger', name: PACKAGE_NAME }])
  })
})
