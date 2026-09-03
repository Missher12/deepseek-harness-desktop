/** Shared acknowledgement limits enforced by both browser batching and Host parsing. */

/** Maximum acknowledgement request bytes. */
export const MAX_ACK_BODY_BYTES = 4 * 1024
/** Maximum delivery identities in one acknowledgement request. */
export const MAX_ACK_DELIVERY_IDS = 128
/** Maximum operator request bytes: one 16 KiB relay plus bounded JSON metadata. */
export const MAX_OPERATOR_BODY_BYTES = 18 * 1024
