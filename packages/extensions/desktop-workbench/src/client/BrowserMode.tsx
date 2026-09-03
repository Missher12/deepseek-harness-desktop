import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './BrowserMode.module.css'

type Props = PropsRuntime<'layout.utility'> & PropsLocale<typeof NS>
interface DesktopBrowserBounds { x: number; y: number; width: number; height: number }
type DesktopBrowserRequest = { kind: 'navigate'; value: string } | { kind: 'back' | 'forward' | 'reload' | 'stop' }
interface DesktopBrowserSnapshot {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
}
interface DesktopBrowserApi {
  showWorkbenchBrowser(bounds: DesktopBrowserBounds): Promise<DesktopBrowserSnapshot>
  hideWorkbenchBrowser(): Promise<void>
  controlWorkbenchBrowser(request: DesktopBrowserRequest): Promise<DesktopBrowserSnapshot>
  onWorkbenchBrowserState(listener: (snapshot: DesktopBrowserSnapshot) => void): () => void
}

function desktopApi(): DesktopBrowserApi | undefined {
  return (window as unknown as { dshDesktop?: DesktopBrowserApi }).dshDesktop
}

export function BrowserMode({ t }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [address, setAddress] = useState('')
  const [snapshot, setSnapshot] = useState<DesktopBrowserSnapshot>({
    url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: null,
  })
  const [error, setError] = useState<string>()
  const invoke = async (request: DesktopBrowserRequest) => {
    const api = desktopApi()
    if (api === undefined) { setError(t('browserDesktopOnly')); return }
    try {
      const next = await api.controlWorkbenchBrowser(request)
      setSnapshot(next)
      if (next.url !== '') setAddress(next.url)
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  useEffect(() => {
    const api = desktopApi()
    const element = host.current
    if (api === undefined || element === null) { setError(t('browserDesktopOnly')); return }
    let frame = 0
    let mounted = true
    const show = () => {
      frame = 0
      const rect = element.getBoundingClientRect()
      const bounds: DesktopBrowserBounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      void api.showWorkbenchBrowser(bounds).then((next) => { if (mounted) setSnapshot(next) }, (reason: unknown) => {
        if (mounted) setError(reason instanceof Error ? reason.message : String(reason))
      })
    }
    const schedule = () => { if (frame === 0) frame = requestAnimationFrame(show) }
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    const unsubscribe = api.onWorkbenchBrowserState((next) => {
      setSnapshot(next)
      if (next.url !== '') setAddress(next.url)
    })
    schedule()
    return () => {
      mounted = false
      observer.disconnect()
      unsubscribe()
      if (frame !== 0) cancelAnimationFrame(frame)
      void api.hideWorkbenchBrowser().catch(() => {})
    }
  }, [t])
  return <div className={css.browser}>
    <form className={css.toolbar} onSubmit={(event) => { event.preventDefault(); void invoke({ kind: 'navigate', value: address }) }}>
      <button type="button" aria-label={t('back')} disabled={!snapshot.canGoBack} onClick={() => { void invoke({ kind: 'back' }) }}>‹</button>
      <button type="button" aria-label={t('forward')} disabled={!snapshot.canGoForward} onClick={() => { void invoke({ kind: 'forward' }) }}>›</button>
      <button type="button" aria-label={snapshot.loading ? t('stop') : t('reload')}
        onClick={() => { void invoke({ kind: snapshot.loading ? 'stop' : 'reload' }) }}>{snapshot.loading ? '×' : '↻'}</button>
      <input value={address} onChange={(event) => { setAddress(event.target.value) }} placeholder={t('browserPlaceholder')} />
    </form>
    <div className={css.status}><span>{snapshot.title || t('browserNewTab')}</span>{(error ?? snapshot.error) && <strong>{error ?? snapshot.error}</strong>}</div>
    <div ref={host} className={css.host} data-native-browser-host><span>{t('browserNewTab')}</span></div>
  </div>
}
