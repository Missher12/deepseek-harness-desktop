import { errors as playwrightErrors, type Locator, type Page } from 'playwright'
import { expect, it, vi } from 'vitest'
import { clickSessionAction } from './session-workspace-smoke.ts'

function fakeRow(action: { isVisible: () => Promise<boolean>; click: (options: { timeout: number }) => Promise<void> }) {
  return {
    getByRole: vi.fn(() => action),
    hover: vi.fn(async () => {}),
  } as unknown as Locator & { hover: ReturnType<typeof vi.fn> }
}

function fakePage() {
  const move = vi.fn(async (_x: number, _y: number) => {})
  return {
    page: { mouse: { move } } as unknown as Page,
    move,
  }
}

it('retries a visible session action after a click timeout and requires the real click', async () => {
  let attempts = 0
  const action = {
    isVisible: vi.fn(async () => true),
    click: vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new playwrightErrors.TimeoutError('first click timed out')
    }),
  }
  const row = fakeRow(action)
  const { page, move } = fakePage()

  await clickSessionAction(page, row, /Session actions for/u, 1_000)

  expect(action.click).toHaveBeenCalledTimes(2)
  expect(move).toHaveBeenCalledWith(0, 0)
  expect(row.hover).not.toHaveBeenCalled()
})

it('does not treat a visible session action as success when every real click times out', async () => {
  const action = {
    isVisible: vi.fn(async () => true),
    click: vi.fn(async () => { throw new playwrightErrors.TimeoutError('click timed out') }),
  }
  const row = fakeRow(action)
  const { page } = fakePage()

  await expect(clickSessionAction(page, row, /Session actions for/u, 100)).rejects.toThrow()
  expect(action.click).toHaveBeenCalled()
})
