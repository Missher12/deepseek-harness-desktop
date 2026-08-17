// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EffortSlider, type EffortChoice } from '../src/client/EffortSlider.tsx'

const choices: readonly EffortChoice[] = [
  { key: 'off', effort: 'off', label: 'Off' },
  { key: 'high', effort: 'high', label: 'High' },
  { key: 'max', effort: 'max', label: 'Maximum', description: 'Largest budget' },
]

afterEach(cleanup)

describe('EffortSlider', () => {
  it('previews continuously but commits only the nearest advertised stop on release', () => {
    const onCommit = vi.fn()
    render(<EffortSlider
      label="Reasoning effort"
      fasterLabel="Faster"
      smarterLabel="Smarter"
      choices={choices}
      value="off"
      disabled={false}
      onCommit={onCommit}
    />)
    const slider = screen.getByRole('slider')
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 52,
      width: 200,
      height: 52,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(slider, { clientX: 0, buttons: 1 })
    fireEvent.pointerMove(slider, { clientX: 196, buttons: 1 })
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider, { clientX: 196 })

    expect(onCommit).toHaveBeenLastCalledWith('max')
    expect(onCommit.mock.calls.flat()).not.toEqual(expect.arrayContaining(['low', 'medium']))
  })

  it('keeps the particle renderer inside the native Harness effort surface', () => {
    render(<EffortSlider
      label="Reasoning effort"
      fasterLabel="Faster"
      smarterLabel="Smarter"
      choices={choices}
      value="high"
      disabled={false}
      onCommit={vi.fn()}
    />)

    const panel = screen.getByTestId('effort-panel')
    const canvas = screen.getByTestId('effort-fire-canvas')
    expect(panel.contains(canvas)).toBe(true)
    expect(canvas.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('Faster')).toBeTruthy()
    expect(screen.getByText('Smarter')).toBeTruthy()
  })

  it('keeps Host labels for unknown identifiers and blocks commits while disabled', () => {
    const onCommit = vi.fn()
    render(<EffortSlider
      label="Reasoning effort"
      fasterLabel="Faster"
      smarterLabel="Smarter"
      choices={[...choices, { key: 'future', effort: 'adaptive-plus', label: 'Adaptive Plus' }]}
      value="adaptive-plus"
      disabled
      onCommit={onCommit}
    />)

    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('Adaptive Plus')
    expect(screen.getAllByText('Adaptive Plus')).toHaveLength(2)
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Home' })
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Off' }))
    expect(onCommit).not.toHaveBeenCalled()
  })
})
