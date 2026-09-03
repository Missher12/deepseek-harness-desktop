/** Browser entry for the Web client. */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import { installDesktopSurface } from './desktop-surface.ts'

const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')
const disposeDesktopSurface = installDesktopSurface(new URL(window.location.href), window.dshDesktop)
window.addEventListener('pagehide', disposeDesktopSurface, { once: true })
void new AppWebEntry(el).run()
