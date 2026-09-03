/**
 * Desktop boot-surface copy.
 *
 * The surface renders before the Host locale seat exists, so its strings live
 * here as a locale-owned module instead of being embedded in the component.
 */
export const BOOT_COPY = {
  eyebrow: 'Local intelligence system',
  title: 'DeepSeek',
  titleAccent: 'Harness',
  ready: 'Desktop runtime ready',
  startingAriaLabel: '正在启动',
  startingAriaValueText: '正在初始化桌面运行时',
  failedTitle: 'Failed to load plugins',
} as const
