import { describe, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('system update node half', () => {
  it('is intentionally inert because Electron owns the update lifecycle', () => {
    apply()
  })
})
