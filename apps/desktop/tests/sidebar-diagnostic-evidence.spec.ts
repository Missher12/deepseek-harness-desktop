import { expect, it } from 'vitest'
import { sidebarDiagnosticFailure } from './sidebar-diagnostic-evidence.ts'

it('preserves the original numeric post-click matcher failure through unsafe smoke wrappers', () => {
  const matcher = new Error('expected 1 to be +0 // Object.is equality', { cause: new Error('Matcher did not succeed in time.') })
  const error = new Error('unsafe URL and renderer body', { cause: matcher })
  expect(sidebarDiagnosticFailure(error)).toEqual({ classification: 'collapsed-after-click', messages: [
    'expected 1 to be +0 // Object.is equality', 'Matcher did not succeed in time.',
  ] })
})

it('distinguishes an unavailable open button from the post-click assertion', () => {
  expect(sidebarDiagnosticFailure(new Error('locator.waitFor: Timeout 15000ms exceeded.\nprivate call log'))).toEqual({
    classification: 'open-button-unavailable', messages: ['locator.waitFor: Timeout 15000ms exceeded.'],
  })
})

it('drops arbitrary messages, paths, credentials and non-errors', () => {
  for (const error of [new Error('https://example.invalid/?token=private'), new Error('/Users/private/.dsh'), { message: 'secret' }, null]) {
    expect(sidebarDiagnosticFailure(error)).toEqual({ classification: 'other', messages: [] })
  }
})

it('bounds cyclic error causes without weakening the original failure classification', () => {
  const error = new Error('expected 1 to be +0 // Object.is equality')
  error.cause = error
  expect(sidebarDiagnosticFailure(error)).toEqual({ classification: 'collapsed-after-click', messages: [error.message] })
})
