import { describe, expect, it } from 'vitest'
import { EMPTY_UPDATE_SNAPSHOT, createSystemUpdateStore } from '../src/client/store.ts'

describe('system update store', () => {
  it('creates an isolated empty snapshot and replaces it only through sync', () => {
    const first = createSystemUpdateStore().create()
    const second = createSystemUpdateStore().create()
    expect(first.getSnapshot().snapshot).toEqual(EMPTY_UPDATE_SNAPSHOT)
    expect(first.getSnapshot().snapshot).not.toBe(EMPTY_UPDATE_SNAPSHOT)

    first.actions.sync({ ...EMPTY_UPDATE_SNAPSHOT, phase: 'checking' })
    expect(first.getSnapshot().snapshot.phase).toBe('checking')
    expect(second.getSnapshot().snapshot.phase).toBe('idle')
  })
})
