// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EffortSlider } from '../src/client/EffortControl.tsx'
import { drawRadiation } from '../src/client/draw-radiation.ts'
import { zh } from '../src/client/locales.ts'

const gradient = () => ({ addColorStop: vi.fn() }) as unknown as CanvasGradient

function canvasContext() {
  const mocks = {
    clearRect: vi.fn(), save: vi.fn(), beginPath: vi.fn(), rect: vi.fn(),
    clip: vi.fn(), fillRect: vi.fn(), restore: vi.fn(), setTransform: vi.fn(),
    createLinearGradient: vi.fn(gradient), createRadialGradient: vi.fn(gradient),
  }
  const context = {
    ...mocks,
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D
  return { context, ...mocks }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('attributed Canvas radiation', () => {
  it('retains the upstream left clip, pixel wave, fourteen streak gradients, and one glow', () => {
    const { context, rect, clip, createLinearGradient, createRadialGradient, fillRect } = canvasContext()
    drawRadiation(context, 320, 32, 0, { progress: 1, dragging: false })

    expect(rect).toHaveBeenCalledWith(0, 0, 320, 32)
    expect(clip).toHaveBeenCalledTimes(1)
    expect(createLinearGradient).toHaveBeenCalledTimes(14)
    expect(createRadialGradient).toHaveBeenCalledTimes(1)
    expect(fillRect.mock.calls.length).toBeGreaterThan(15)
  })

  it('keeps the Canvas and accessible slider static under reduced motion', () => {
    const { context, clearRect } = canvasContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const requestFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
    })

    render(createElement(EffortSlider, {
      levels: [{ id: 'low', name: 'Low' }, { id: 'max', name: 'Max' }],
      acceptedIndex: 0,
      previewIndex: 0,
      disabled: false,
      dragging: false,
      chibiThumb: false,
      error: null,
      t: (key: string) => (zh as Record<string, string>)[key] ?? key,
      onPreview: vi.fn(),
      onCommit: vi.fn(),
      onDraggingChange: vi.fn(),
    }))

    expect(screen.getByRole('slider', { name: '推理等级' })).toBeTruthy()
    expect(document.querySelector('canvas')).toBeTruthy()
    expect(requestFrame).not.toHaveBeenCalled()
    expect(clearRect).toHaveBeenCalled()
  })
})
