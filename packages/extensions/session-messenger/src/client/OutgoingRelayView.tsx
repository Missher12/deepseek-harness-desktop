import { memo, useState, useSyncExternalStore } from 'react'
import { IconSendOutline16, MessageText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OutgoingRelayChatData } from './outgoing-definition.ts'
import type { ISessionMessengerClient } from './index.tsx'
import { NS } from './locales.ts'
import css from './OutgoingRelayView.module.css'

type Props = PropsRuntime<'conversation.chat.node', 'session-relay-outgoing'>
  & PropsLocale<typeof NS>
  & InjectFace<{ messenger: ISessionMessengerClient }>

/** Right-aligned source transcript row that never enters model history. */
export const OutgoingRelayView = memo(function OutgoingRelayView({ node, t, messenger }: Props) {
  const data: OutgoingRelayChatData = node.data
  const snapshot = useSyncExternalStore(messenger.store.subscribe, messenger.store.getSnapshot)
  const receipt = snapshot.receipts.get(String(data.deliveryId))
  const stopped = receipt?.collaborationStoppedAt !== undefined
  const [stopping, setStopping] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <div className={css.row} data-session-relay-outgoing>
      <div className={css.stack}>
        <div className={css.meta}>
          <IconSendOutline16 size={13} />
          <span>{t('sentTo', { target: data.targetSessionId })}</span>
          {data.wakeRequested && <span>{t('wakeShort')}</span>}
          {stopped
            ? <span className={css.stopped}>{t('stopped')}</span>
            : receipt !== undefined && <button
              type="button"
              className={css.stop}
              disabled={stopping}
              onClick={() => {
                setStopping(true)
                setFailed(false)
                void messenger.stop(receipt.sourceSessionId, receipt.deliveryId)
                  .catch(() => { setFailed(true) })
                  .finally(() => { setStopping(false) })
              }}
            >{stopping ? t('stopping') : t('stop')}</button>}
        </div>
        <div className={css.bubble}><MessageText text={data.body} /></div>
        {data.status === 'delivery-recovery-pending' && <small>{t('recoveryPending')}</small>}
        {failed && <small>{t('stopFailed')}</small>}
      </div>
    </div>
  )
})
