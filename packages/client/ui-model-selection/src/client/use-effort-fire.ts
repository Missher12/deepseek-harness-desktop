/**
 * WebGL2 particle trail adapted from dsh-effort-slider 0.2.5
 * (https://github.com/2768651338/dsh-effort-slider, BSD-3-Clause).
 * The renderer is presentation-only and never owns effort values or writes.
 */
import { useEffect, useRef, type RefObject } from 'react'
import {
  EFFORT_FIRE_BLUR,
  EFFORT_FIRE_COMPOSITE,
  EFFORT_FIRE_SIMULATION,
  EFFORT_FIRE_VERTEX,
} from './effort-fire-shaders.ts'

interface RenderTarget {
  fbo: WebGLFramebuffer
  texture: WebGLTexture
}

/**
 * Render a transparent DeepSeek-blue particle trail behind one effort slider.
 *
 * @param canvasRef - Canvas owned by the effort selector presentation.
 * @param progress - Normalized selected-stop position from zero through one.
 * @param motionAllowed - Whether animation is permitted by user preferences.
 */
export function useEffortFire(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  progress: number,
  motionAllowed: boolean,
): void {
  const progressRef = useRef(progress)
  const ensureLoopRef = useRef<(() => void) | null>(null)
  progressRef.current = progress

  useEffect(() => {
    const canvas = canvasRef.current
    if (!motionAllowed || canvas === null || typeof WebGL2RenderingContext === 'undefined') return

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    })
    if (gl === null) return

    let animation: number | undefined
    let observer: ResizeObserver | undefined
    let resizeTimer: number | undefined
    let running = false
    let startedAt = performance.now()
    let lastFrame = startedAt
    let spring = progressRef.current
    let velocity = 0

    let simulation: WebGLProgram | null = null
    let blur: WebGLProgram | null = null
    let composite: WebGLProgram | null = null
    let vertexArray: WebGLVertexArrayObject | null = null
    let vertexBuffer: WebGLBuffer | null = null
    let previous: RenderTarget | null = null
    let current: RenderTarget | null = null
    let horizontal: RenderTarget | null = null
    let vertical: RenderTarget | null = null

    const uniforms: Record<
      | 'simTime' | 'simSlider' | 'simElapsed' | 'simBack'
      | 'blurDirection' | 'blurResolution' | 'blurExtract' | 'blurTexture'
      | 'compositeScene' | 'compositeGlow',
      WebGLUniformLocation | null
    > = {
      simTime: null,
      simSlider: null,
      simElapsed: null,
      simBack: null,
      blurDirection: null,
      blurResolution: null,
      blurExtract: null,
      blurTexture: null,
      compositeScene: null,
      compositeGlow: null,
    }

    const compileShader = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type)
      if (shader === null) return null
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
      gl.deleteShader(shader)
      return null
    }

    const linkProgram = (fragment: string): WebGLProgram | null => {
      const vertex = compileShader(gl.VERTEX_SHADER, EFFORT_FIRE_VERTEX)
      const pixel = compileShader(gl.FRAGMENT_SHADER, fragment)
      if (vertex === null || pixel === null) {
        if (vertex !== null) gl.deleteShader(vertex)
        if (pixel !== null) gl.deleteShader(pixel)
        return null
      }
      const program = gl.createProgram() as WebGLProgram | null
      if (program === null) {
        gl.deleteShader(vertex)
        gl.deleteShader(pixel)
        return null
      }
      gl.attachShader(program, vertex)
      gl.attachShader(program, pixel)
      gl.bindAttribLocation(program, 0, 'a_pos')
      gl.linkProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(pixel)
      if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program
      gl.deleteProgram(program)
      return null
    }

    const destroyTarget = (target: RenderTarget | null): void => {
      if (target === null) return
      gl.deleteFramebuffer(target.fbo)
      gl.deleteTexture(target.texture)
    }

    const destroyTargets = (): void => {
      destroyTarget(previous)
      destroyTarget(current)
      destroyTarget(horizontal)
      destroyTarget(vertical)
      previous = current = horizontal = vertical = null
    }

    const createTarget = (): RenderTarget | null => {
      const fbo = gl.createFramebuffer() as WebGLFramebuffer | null
      const texture = gl.createTexture() as WebGLTexture | null
      if (fbo === null || texture === null) return null
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        canvas.width,
        canvas.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      )
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      return { fbo, texture }
    }

    const resize = (): boolean => {
      const bounds = canvas.getBoundingClientRect()
      const width = bounds.width || canvas.clientWidth
      const height = bounds.height || canvas.clientHeight
      if (width <= 0 || height <= 0) return false
      const density = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * density)
      canvas.height = Math.round(height * density)
      destroyTargets()
      previous = createTarget()
      current = createTarget()
      horizontal = createTarget()
      vertical = createTarget()
      return previous !== null && current !== null && horizontal !== null && vertical !== null
    }

    const clearCanvas = (): void => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }

    const render = (time: number): void => {
      const delta = Math.min((time - lastFrame) / 1_000, 0.05)
      lastFrame = time
      const target = progressRef.current
      const force = (target - spring) * 16
      velocity = (velocity + force * delta) * Math.max(0, 1 - 8 * delta)
      spring = Math.max(0, Math.min(1, spring + velocity * delta))
      if (Math.abs(target - spring) < 0.001 && Math.abs(velocity) < 0.001) {
        spring = target
        velocity = 0
      }

      if (target <= 0 && spring <= 0.001) {
        clearCanvas()
        running = false
        animation = undefined
        return
      }

      if (previous !== null && current !== null && horizontal !== null && vertical !== null
        && simulation !== null && blur !== null && composite !== null) {
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.bindVertexArray(vertexArray)

        gl.bindFramebuffer(gl.FRAMEBUFFER, current.fbo)
        gl.useProgram(simulation)
        gl.uniform1f(uniforms.simTime, time / 1_000)
        gl.uniform1f(uniforms.simSlider, spring)
        gl.uniform1f(uniforms.simElapsed, (time - startedAt) / 1_000)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, previous.texture)
        gl.uniform1i(uniforms.simBack, 0)
        gl.drawArrays(gl.TRIANGLES, 0, 6)

        gl.useProgram(blur)
        gl.uniform2f(uniforms.blurResolution, canvas.width, canvas.height)
        gl.bindFramebuffer(gl.FRAMEBUFFER, horizontal.fbo)
        gl.uniform2f(uniforms.blurDirection, 1, 0)
        gl.uniform1f(uniforms.blurExtract, 1)
        gl.bindTexture(gl.TEXTURE_2D, current.texture)
        gl.uniform1i(uniforms.blurTexture, 0)
        gl.drawArrays(gl.TRIANGLES, 0, 6)

        gl.bindFramebuffer(gl.FRAMEBUFFER, vertical.fbo)
        gl.uniform2f(uniforms.blurDirection, 0, 1)
        gl.uniform1f(uniforms.blurExtract, 0)
        gl.bindTexture(gl.TEXTURE_2D, horizontal.texture)
        gl.drawArrays(gl.TRIANGLES, 0, 6)

        clearCanvas()
        gl.useProgram(composite)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, current.texture)
        gl.uniform1i(uniforms.compositeScene, 0)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, vertical.texture)
        gl.uniform1i(uniforms.compositeGlow, 1)
        gl.drawArrays(gl.TRIANGLES, 0, 6)

        const swap = previous
        previous = current
        current = swap
      }
      animation = requestAnimationFrame(render)
    }

    const ensureLoop = (): void => {
      if (running || progressRef.current <= 0) return
      if (previous === null && !resize()) return
      running = true
      startedAt = lastFrame = performance.now()
      spring = progressRef.current
      velocity = 0
      animation = requestAnimationFrame(render)
    }
    ensureLoopRef.current = ensureLoop

    simulation = linkProgram(EFFORT_FIRE_SIMULATION)
    blur = linkProgram(EFFORT_FIRE_BLUR)
    composite = linkProgram(EFFORT_FIRE_COMPOSITE)
    if (simulation === null || blur === null || composite === null) return

    vertexArray = gl.createVertexArray()
    vertexBuffer = gl.createBuffer()
    gl.bindVertexArray(vertexArray)
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    uniforms.simTime = gl.getUniformLocation(simulation, 'u_time')
    uniforms.simSlider = gl.getUniformLocation(simulation, 'u_slider')
    uniforms.simElapsed = gl.getUniformLocation(simulation, 'u_elapsed')
    uniforms.simBack = gl.getUniformLocation(simulation, 'u_back')
    uniforms.blurDirection = gl.getUniformLocation(blur, 'u_dir')
    uniforms.blurResolution = gl.getUniformLocation(blur, 'u_res')
    uniforms.blurExtract = gl.getUniformLocation(blur, 'u_ext')
    uniforms.blurTexture = gl.getUniformLocation(blur, 'u_tex')
    uniforms.compositeScene = gl.getUniformLocation(composite, 'u_scene')
    uniforms.compositeGlow = gl.getUniformLocation(composite, 'u_glow')

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    resize()
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        window.clearTimeout(resizeTimer)
        resizeTimer = window.setTimeout(resize, 80)
      })
      observer.observe(canvas)
    }
    ensureLoop()

    return () => {
      if (animation !== undefined) cancelAnimationFrame(animation)
      observer?.disconnect()
      window.clearTimeout(resizeTimer)
      ensureLoopRef.current = null
      destroyTargets()
      gl.deleteProgram(simulation)
      gl.deleteProgram(blur)
      gl.deleteProgram(composite)
      gl.deleteVertexArray(vertexArray)
      gl.deleteBuffer(vertexBuffer)
    }
  }, [canvasRef, motionAllowed])

  useEffect(() => {
    if (progress > 0 && motionAllowed) ensureLoopRef.current?.()
  }, [motionAllowed, progress])
}
