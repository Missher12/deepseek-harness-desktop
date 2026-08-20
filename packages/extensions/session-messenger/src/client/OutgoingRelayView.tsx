import { memo } from 'react'
import { IconSendOutline16, MessageText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OutgoingRelayChatData } from './outgoing-definition.ts'
import { NS } from './locales.ts'
import css from './OutgoingRelayView.module.css'

type Props = PropsRuntime<'conversation.chat.node', 'session-relay-outgoing'> & PropsLocale<typeof NS>

/** Right-aligned source transcript row that never enters model history. */
export const OutgoingRelayView = memo(function OutgoingRelayView({ node, t }: Props) {
  const data: OutgoingRelayChatData = node.data
  return (
    <div className={css.row} data-session-relay-outgoing>
      <div className={css.stack}>
        <div className={css.meta}>
          <IconSendOutline16 size={13} />
          <span>{t('sentTo', { target: data.targetSessionId })}</span>
          {data.wakeRequested && <span>{t('wakeShort')}</span>}
        </div>
        <div className={css.bubble}><MessageText text={data.body} /></div>
        {data.status === 'delivery-recovery-pending' && <small>{t('recoveryPending')}</small>}
      </div>
    </div>
  )
})
