import { describe, expect, test, vi } from 'vitest'
import { BindingController, type BindingCatalog, type BindingStore } from '../src/binding.ts'
import type { BindingRecord, OwnerRecord } from '../src/state.ts'

const owner: OwnerRecord = {
  id: 'owner', openId: 'ou_owner', chatId: 'oc_dm', generation: 1,
  pairedAt: 1000, updatedAt: 1000,
}

function harness() {
  let saved: BindingRecord | undefined
  const workspaces = [
    { workspaceId: 'w1', title: 'Harness', path: '/Users/missher/Harness', sessionIds: ['idle', 'run', 'blank', 'child'] },
    { workspaceId: 'w2', title: 'Other', path: '/Users/missher/Other', sessionIds: ['wrong-cwd', 'archived'] },
  ]
  const sessions = [
    { sessionId: 'idle', updatedAt: 4, running: false, blank: false, cwd: '/Users/missher/Harness' },
    { sessionId: 'run', updatedAt: 2, running: true, blank: false, cwd: '/Users/missher/Harness' },
    { sessionId: 'blank', updatedAt: 9, running: false, blank: true, cwd: '/Users/missher/Harness' },
    { sessionId: 'child', updatedAt: 8, running: true, blank: false, origin: 'subagent' as const, cwd: '/Users/missher/Harness' },
    { sessionId: 'wrong-cwd', updatedAt: 7, running: true, blank: false, cwd: '/tmp/not-other' },
    { sessionId: 'archived', updatedAt: 6, running: false, blank: false, cwd: '/Users/missher/Other' },
  ]
  const archivedSessionIds = ['archived']
  const resolveOrdinarySession = vi.fn(async (id: string) => {
    const cwd = sessions.find(row => row.sessionId === id)?.cwd
    return { id, ...(cwd === undefined ? {} : { cwd }) }
  })
  const catalog: BindingCatalog = {
    listWorkspaces: vi.fn(async () => ({ items: workspaces, archivedSessionIds })),
    listSessions: vi.fn(async () => sessions),
    resolveOrdinarySession,
  }
  const store: BindingStore = {
    get: async () => saved,
    put: async (value) => { saved = value },
    delete: async () => { saved = undefined },
  }
  return {
    catalog, store, workspaces, sessions, archivedSessionIds, resolveOrdinarySession,
    controller: new BindingController(catalog, store, async () => owner, () => 2000),
    saved: () => saved,
  }
}

describe('project and ordinary Session binding', () => {
  test('preserves project order and exposes each full local path', async () => {
    const h = harness()
    await expect(h.controller.listProjects()).resolves.toEqual([
      { workspaceId: 'w1', title: 'Harness', path: '/Users/missher/Harness' },
      { workspaceId: 'w2', title: 'Other', path: '/Users/missher/Other' },
    ])
  })

  test('shows only ordinary matching Sessions with running first', async () => {
    const h = harness()
    await expect(h.controller.listSessions('w1')).resolves.toEqual([
      expect.objectContaining({ sessionId: 'run', running: true }),
      expect.objectContaining({ sessionId: 'idle', running: false }),
    ])
    await expect(h.controller.listSessions('w2')).resolves.toEqual([])
  })

  test('revalidates selection, resolves through Host policy, and increments generation', async () => {
    const h = harness()
    await expect(h.controller.bind('w1', 'run')).resolves.toMatchObject({
      ownerOpenId: 'ou_owner', chatId: 'oc_dm', projectPath: '/Users/missher/Harness',
      sessionId: 'run', generation: 1, state: 'active',
    })
    await h.controller.bind('w1', 'idle')
    expect(h.saved()).toMatchObject({ sessionId: 'idle', generation: 2 })
    expect(h.resolveOrdinarySession).toHaveBeenLastCalledWith('idle')
  })

  test('rejects stale, archived, subagent, blank, and cwd-mismatched actions', async () => {
    const h = harness()
    await expect(h.controller.bind('w1', 'blank')).rejects.toThrow(/not selectable/)
    await expect(h.controller.bind('w1', 'child')).rejects.toThrow(/not selectable/)
    await expect(h.controller.bind('w2', 'wrong-cwd')).rejects.toThrow(/not selectable/)
    await expect(h.controller.bind('w2', 'archived')).rejects.toThrow(/not selectable/)
    await expect(h.controller.bind('missing', 'run')).rejects.toThrow(/project/)
  })

  test('restart recovery pauses a binding that no longer validates', async () => {
    const h = harness()
    await h.controller.bind('w1', 'run')
    h.archivedSessionIds.push('run')
    await expect(h.controller.recover()).resolves.toMatchObject({ state: 'paused' })
    expect(h.saved()).toMatchObject({ state: 'paused' })
  })
})
