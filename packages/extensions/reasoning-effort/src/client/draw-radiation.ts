/** Live inputs for the attributed effort radiation renderer. */
export interface RadiationState {
  readonly progress: number
  readonly dragging: boolean
}

/**
 * Draw HanaAyane's left-clipped pixel radiation, streaks, and radial glow.
 *
 * This algorithm is intentionally retained from dsh-reasoning-effort v0.6.0,
 * commit f94622b46078ac8c064f91bdc10ab27e8cf32270 (MIT). Placement and
 * product chrome live elsewhere; the effect itself is not redrawn.
 * @param context - Canvas 2D context owned by the effort control.
 * @param width - Current backing-store width in pixels.
 * @param height - Current backing-store height in pixels.
 * @param time - Animation timestamp supplied by requestAnimationFrame.
 * @param state - Current slider progress and drag state.
 */
export function drawRadiation(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  state: RadiationState,
): void {
  const origin = state.progress * width
  const isDark = document.body.hasAttribute('data-ds-dark-theme')
  const cell = 4
  const speed = state.dragging ? 2.8 : 1

  context.clearRect(0, 0, width, height)
  if (origin <= 0) return

  context.save()
  context.beginPath()
  context.rect(0, 0, origin, height)
  context.clip()

  for (let x = 0; x < origin; x += cell) {
    const delta = x + cell * 0.5 - origin
    const distance = Math.abs(delta)
    const phaseA = distance / 10 - time * 0.0074 * speed
    const phaseB = distance / 23 - time * 0.0041 * speed + 1.7
    const phaseC = distance / 40 - time * 0.0022 * speed + 3.4
    const sinA = Math.max(0, Math.sin(phaseA))
    const sinB = Math.max(0, Math.sin(phaseB))
    const sinC = Math.max(0, Math.sin(phaseC))
    const waveA = Math.pow(sinA, 2.6)
    const waveB = Math.pow(sinB, 3.2)
    const waveC = Math.pow(sinC, 4)
    const crest = Math.pow(sinA, 15) + Math.pow(sinB, 18) * 0.78
    const wave = Math.min(1, waveA * 0.76 + waveB * 0.58 + waveC * 0.32)
    const trail = 0.38 + 0.62 * Math.exp(-distance / Math.max(55, width * 0.72))
    const pillar = Math.pow(Math.max(0, Math.sin(x / 20 + time * 0.0016)), 3) * 0.27
    const columnEnergy = trail * (wave * 1.04 + pillar + crest * 0.32)

    if (columnEnergy > 0.012) {
      const nearness = Math.max(0, 1 - distance / Math.max(1, width * 0.78))
      const red = isDark
        ? Math.round(42 + 124 * nearness + 75 * wave)
        : Math.round(28 + 58 * nearness + 15 * wave)
      const green = isDark
        ? Math.round(56 + 58 * nearness + 44 * crest)
        : Math.round(88 + 72 * nearness + 30 * crest)
      const blue = isDark
        ? Math.round(175 + 72 * nearness + 8 * wave)
        : Math.round(182 + 62 * nearness)
      const alpha = isDark
        ? Math.min(0.88, columnEnergy * 0.72)
        : Math.min(0.62, columnEnergy * 0.54)
      context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`
      context.fillRect(x, 0, cell - 1, height)
    }

    for (let y = 0; y < height; y += cell) {
      const deltaY = y + cell * 0.5 - height * 0.5
      const radial = Math.hypot(delta / 38, deltaY / 11)
      const halo = Math.exp(-radial * 0.96) * 1.08
      const verticalShape = 0.58 + 0.42 * Math.cos((deltaY / height) * Math.PI)
      const grain = 0.72 + 0.28 * Math.sin(x * 0.73 + y * 1.31 + time * 0.006)
      const alpha = Math.min(0.96, (columnEnergy * 0.88 + halo + crest * 0.19) * verticalShape * grain)
      if (alpha < 0.035) continue

      const hot = Math.max(0, 1 - radial / 2.4)
      const red = isDark
        ? Math.round(54 + 148 * hot + 42 * wave + 35 * crest)
        : Math.round(25 + 72 * hot + 12 * wave)
      const green = isDark
        ? Math.round(68 + 78 * hot + 46 * crest)
        : Math.round(98 + 72 * hot + 24 * crest)
      const blue = isDark
        ? Math.round(186 + 64 * hot)
        : Math.round(194 + 56 * hot)
      context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${isDark ? alpha : alpha * 0.72})`
      context.fillRect(x, y, cell - 1, cell - 1)
    }
  }

  for (let i = 0; i < 14; i += 1) {
    const travel = (time * (state.dragging ? 0.16 : 0.065) * (0.78 + (i % 5) * 0.09) + i * 23) % Math.max(30, origin + 64)
    const particleX = origin - travel
    if (particleX < -24 || particleX > width + 16) continue
    const particleY = 3 + ((i * 13 + Math.sin(time * 0.003 + i) * 5) % Math.max(7, height - 6))
    const length = 4 + (i % 4) * 4 + (state.dragging ? 6 : 0)
    const alpha = 0.28 + (i % 5) * 0.1
    const streak = context.createLinearGradient(particleX, 0, particleX + length, 0)
    streak.addColorStop(0, isDark ? 'rgba(72,118,255,0)' : 'rgba(24,94,184,0)')
    streak.addColorStop(0.68, isDark ? `rgba(112,135,255,${alpha})` : `rgba(36,108,202,${alpha * 0.72})`)
    streak.addColorStop(1, isDark ? `rgba(236,222,255,${Math.min(1, alpha + 0.26)})` : `rgba(103,175,248,${Math.min(0.82, alpha + 0.18)})`)
    context.fillStyle = streak
    context.fillRect(particleX, particleY, length, i % 3 === 0 ? 2 : 1)
  }

  const glow = context.createRadialGradient(origin, height / 2, 0, origin, height / 2, 24)
  glow.addColorStop(0, isDark ? 'rgba(255,255,255,.82)' : 'rgba(255,255,255,.86)')
  glow.addColorStop(0.14, isDark ? 'rgba(183,190,255,.54)' : 'rgba(162,210,255,.48)')
  glow.addColorStop(0.44, isDark ? 'rgba(103,74,255,.28)' : 'rgba(37,112,207,.22)')
  glow.addColorStop(1, isDark ? 'rgba(86,31,210,0)' : 'rgba(25,91,181,0)')
  context.fillStyle = glow
  context.fillRect(origin - 26, 0, 52, height)
  context.restore()
}
