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
interface BrowserTakeoverStatus {
  phase: 'human' | 'given' | 'agent' | 'stopping'
  signedInWarning: true
}
interface DesktopBrowserApi {
  showWorkbenchBrowser(bounds: DesktopBrowserBounds): Promise<DesktopBrowserSnapshot>
  hideWorkbenchBrowser(): Promise<void>
  controlWorkbenchBrowser(request: DesktopBrowserRequest): Promise<DesktopBrowserSnapshot>
  onWorkbenchBrowserState(listener: (snapshot: DesktopBrowserSnapshot) => void): () => void
  giveWorkbenchBrowserToAgent?(): Promise<BrowserTakeoverStatus>
  stopAgentBrowser?(): Promise<BrowserTakeoverStatus>
  getBrowserTakeoverStatus?(): Promise<BrowserTakeoverStatus>
  onBrowserTakeoverStatus?(listener: (status: BrowserTakeoverStatus) => void): () => void
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
  const [takeover, setTakeover] = useState<BrowserTakeoverStatus>({ phase: 'human', signedInWarning: true })
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
    const unsubscribeTakeover = api.onBrowserTakeoverStatus?.(setTakeover) ?? (() => {})
    void api.getBrowserTakeoverStatus?.().then((status) => {
      if (mounted) setTakeover(status)
    }, (reason: unknown) => {
      if (mounted) setError(reason instanceof Error ? reason.message : String(reason))
    })
    schedule()
    return () => {
      mounted = false
      observer.disconnect()
      unsubscribe()
      unsubscribeTakeover()
      if (frame !== 0) cancelAnimationFrame(frame)
      void api.hideWorkbenchBrowser().catch(() => {})
    }
  }, [t])
  const give = async () => {
    const api = desktopApi()
    if (api?.giveWorkbenchBrowserToAgent === undefined) { setError(t('browserDesktopOnly')); return }
    if (!window.confirm(t('browserGiveWarning'))) return
    try {
      setError(undefined)
      setTakeover(await api.giveWorkbenchBrowserToAgent())
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const stopAgent = async () => {
    const api = desktopApi()
    if (api?.stopAgentBrowser === undefined) { setError(t('browserDesktopOnly')); return }
    const previous = takeover
    setTakeover({ phase: 'stopping', signedInWarning: true })
    try {
      setError(undefined)
      setTakeover(await api.stopAgentBrowser())
    } catch (reason: unknown) {
      setTakeover(previous)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const controlled = takeover.phase !== 'human'
  return <div className={css.browser}>
    <form className={css.toolbar} onSubmit={(event) => { event.preventDefault(); void invoke({ kind: 'navigate', value: address }) }}>
      <button type="button" aria-label={t('back')} disabled={controlled || !snapshot.canGoBack} onClick={() => { void invoke({ kind: 'back' }) }}>‹</button>
      <button type="button" aria-label={t('forward')} disabled={controlled || !snapshot.canGoForward} onClick={() => { void invoke({ kind: 'forward' }) }}>›</button>
      <button type="button" aria-label={snapshot.loading ? t('stop') : t('reload')} disabled={controlled}
        onClick={() => { void invoke({ kind: snapshot.loading ? 'stop' : 'reload' }) }}>{snapshot.loading ? '×' : '↻'}</button>
      <input disabled={controlled} value={address} onChange={(event) => { setAddress(event.target.value) }} placeholder={t('browserPlaceholder')} />
      {takeover.phase === 'human'
        ? <button className={css.takeoverButton} type="button" aria-label={t('browserGive')} onClick={() => { void give() }}>{t('browserGive')}</button>
        : <button className={css.takeoverButton} type="button"
          aria-label={takeover.phase === 'stopping' ? t('browserStopping') : t('browserStopAgent')}
          disabled={takeover.phase === 'stopping'} onClick={() => { void stopAgent() }}>
          {takeover.phase === 'stopping' ? t('browserStopping') : t('browserStopAgent')}
        </button>}
    </form>
    <div className={css.status}>
      <span>{controlled ? t(takeover.phase === 'given' ? 'browserAgentWaiting' : 'browserAgentActive') : snapshot.title || t('browserNewTab')}</span>
      {(error ?? snapshot.error) && <strong>{error ?? snapshot.error}</strong>}
    </div>
    <div ref={host} className={css.host} data-native-browser-host><span>{t('browserNewTab')}</span></div>
  </div>
}
