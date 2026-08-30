import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  SERVICE_API,
  TYPE_API,
  queryServiceApi,
} from '../src/api-catalog.ts'
import { describeApi, describeServices } from '../src/inspect.ts'

describe('model-visible Cordis authority catalog', () => {
  it('withholds Desktop control services, lease acquisition, and authority DTOs', () => {
    const directory = queryServiceApi() as {
      readonly services: readonly { readonly key: string; readonly methods: readonly { readonly signature: string }[] }[]
    }
    const keys = directory.services.map(service => service.key)

    expect(keys).not.toContain('browserControl')
    expect(keys).not.toContain('computerControl')
    expect(() => queryServiceApi('browserControl')).toThrow(/no catalogued Service/i)
    expect(() => queryServiceApi('computerControl')).toThrow(/no catalogued Service/i)
    expect(JSON.stringify({ services: SERVICE_API, types: TYPE_API })).not.toMatch(
      /acquireLease|ControlLeaseAcquireRequest|ControlLeaseAcquireResult|ControlLeaseCapability|ControlLeaseTarget/,
    )
  })

  it('does not reveal live Desktop control authorities through inspect fallbacks', () => {
    const ctx = new Context()
    ctx.provide('browserControl', { acquireLease() {} })
    ctx.provide('computerControl', { acquireLease() {} })

    expect(describeServices(ctx).join('\n')).not.toMatch(/browserControl|computerControl/)
    expect(describeApi(ctx).join('\n')).not.toMatch(/browserControl|computerControl|acquireLease/)
  })

  it('keeps inspect closed when a stale or injected catalog contains a Desktop authority', () => {
    const ctx = new Context()
    const staleCatalog = [{
      key: 'browserControl',
      summary: 'Privileged browser control.',
      description: 'Must never be model visible.',
      methods: [{
        signature: 'acquireLease(): void',
        description: 'Acquire privileged control.',
        parameters: [],
      }],
    }]

    expect(describeApi(ctx, staleCatalog).join('\n')).not.toMatch(/browserControl|acquireLease/)
    expect(() => describeApi(ctx, staleCatalog, 'browserControl')).toThrow(/no catalogued service/i)
  })
})
