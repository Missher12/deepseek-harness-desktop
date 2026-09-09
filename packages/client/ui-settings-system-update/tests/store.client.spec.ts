import { describe, expect, it } from 'vitest'
import { EMPTY_UPDATE_SNAPSHOT, createSystemUpdateStore } from '../src/client/store.ts'

describe('system update store', () => {
  it('creates an isolated empty snapshot and replaces it only through sync', () => {
    const first = createSystemUpdateStore().create()
    const second = createSystemUpdateStore().create()
    expect(first.getSnapshot().snapshot).toEqual(EMPTY_UPDATE_SNAPSHOT)
    expect(first.getSnapshot().snapshot).not.toBe(EMPTY_UPDATE_SNAPSHOT)
    expect(first.getSnapshot().snapshot).toMatchObject({
      platform: 'unsupported', arch: 'unsupported', packageFormat: 'unknown',
      installAction: null, supportReason: 'unsupported-runtime',
      assetName: null, downloadedBytes: null, downloadTotalBytes: null,
    })

    first.actions.sync({ ...EMPTY_UPDATE_SNAPSHOT, phase: 'checking' })
    expect(first.getSnapshot().snapshot.phase).toBe('checking')
    expect(second.getSnapshot().snapshot.phase).toBe('idle')
  })

  it('keeps status-load state local and clears failure only after a native snapshot arrives', () => {
    const instance = createSystemUpdateStore().create()
    expect(instance.getSnapshot().statusLoad).toBe('loading')
    instance.actions.loadFailed()
    expect(instance.getSnapshot().statusLoad).toBe('error')
    expect(instance.getSnapshot().snapshot).toEqual(EMPTY_UPDATE_SNAPSHOT)
    instance.actions.loading()
    expect(instance.getSnapshot().statusLoad).toBe('loading')
    instance.actions.sync({ ...EMPTY_UPDATE_SNAPSHOT, phase: 'checking' })
    expect(instance.getSnapshot().statusLoad).toBe('ready')
    expect(instance.getSnapshot().snapshot).not.toHaveProperty('statusLoad')
  })
})
