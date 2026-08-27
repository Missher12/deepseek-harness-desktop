function freezeMatrix<const T extends object>(matrix: T): T {
  for (const fields of Object.values(matrix)) Object.freeze(fields)
  return Object.freeze(matrix)
}

/** Canonical TypeScript bridge field matrix validated against protocol-v1.json. */
export const BRIDGE_REQUEST_FIELDS = freezeMatrix({
  'desktop.status': [],
  'browser.snapshot': ['leaseId', 'leaseRevision', 'includeImage'],
  'browser.navigate': ['leaseId', 'leaseRevision', 'url'],
  'browser.click': ['leaseId', 'leaseRevision', 'ref'],
  'browser.type': ['leaseId', 'leaseRevision', 'ref', 'text'],
  'browser.key': ['leaseId', 'leaseRevision', 'key', 'modifiers'],
  'browser.select': ['leaseId', 'leaseRevision', 'ref', 'value'],
  'browser.scroll': ['leaseId', 'leaseRevision', 'ref', 'deltaX', 'deltaY'],
  'browser.wait': ['leaseId', 'leaseRevision', 'mode', 'durationMs'],
  'browser.back': ['leaseId', 'leaseRevision'],
  'browser.forward': ['leaseId', 'leaseRevision'],
  'browser.reload': ['leaseId', 'leaseRevision'],
  'browser.stop': [],
  'computer.status': [],
  'computer.list': [],
  'computer.snapshot': ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'includeImage'],
  'computer.focus': ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision'],
  'computer.click': ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'ref', 'x', 'y', 'button'],
  'computer.double-click': ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'ref', 'x', 'y', 'button'],
  'computer.drag': ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'fromX', 'fromY', 'toX', 'toY', 'button'],
  'computer.type': ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'ref', 'text'],
  'computer.key': ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'key', 'modifiers'],
  'computer.scroll': ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'ref', 'x', 'y', 'deltaX', 'deltaY'],
  'computer.wait': ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'durationMs'],
  'computer.stop': [],
} as const)

/** Canonical TypeScript helper field matrix validated against protocol-v1.json. */
export const HELPER_REQUEST_FIELDS = freezeMatrix({
  status: [],
  list: [],
  snapshot: ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'includeImage'],
  focus: ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision'],
  click: ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'ref', 'x', 'y', 'button'],
  'double-click': ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'ref', 'x', 'y', 'button'],
  drag: ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'fromX', 'fromY', 'toX', 'toY', 'button'],
  type: ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'ref', 'text'],
  key: ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'key', 'modifiers'],
  scroll: ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'ref', 'x', 'y', 'deltaX', 'deltaY'],
  wait: ['leaseId', 'leaseRevision', 'appId', 'windowId', 'snapshotRevision', 'durationMs'],
  stop: ['leaseId', 'leaseRevision'],
  'lease.install': ['leaseId', 'leaseRevision', 'agentId', 'apps', 'windows', 'capabilities', 'quotas', 'idleExpiresAfterMs', 'hardExpiresAfterMs'],
  'input.release': ['keys', 'buttons'],
} as const)

/** Canonical TypeScript control field matrix validated against protocol-v1.json. */
export const CONTROL_FIELDS = freezeMatrix({
  'request.cancel': ['sessionId', 'requestId'],
  'session.revoke': ['sessionId'],
  'lease.revoke': ['sessionId', 'leaseId', 'leaseRevision'],
  'parent.shutdown': [],
} as const)

/** Canonical TypeScript result field matrix validated against protocol-v1.json. */
export const RESULT_FIELDS = freezeMatrix({
  'desktop.status': ['browserSupported', 'computerSupported'],
  'browser.snapshot': ['surfaceId', 'url', 'title', 'snapshotRevision', 'semanticText', 'refs', 'image'],
  'browser.navigate': ['url', 'snapshotRevision'],
  'browser.click': ['acted', 'snapshotRevision'],
  'browser.type': ['acted', 'snapshotRevision'],
  'browser.key': ['acted', 'snapshotRevision'],
  'browser.select': ['acted', 'snapshotRevision'],
  'browser.scroll': ['acted', 'snapshotRevision'],
  'browser.wait': ['waited', 'snapshotRevision'],
  'browser.back': ['url', 'snapshotRevision'],
  'browser.forward': ['url', 'snapshotRevision'],
  'browser.reload': ['url', 'snapshotRevision'],
  'browser.stop': ['stopped'],
  'computer.status': ['viewing', 'assistive', 'supported'],
  'computer.list': ['apps'],
  'computer.snapshot': ['appId', 'windowId', 'snapshotRevision', 'semanticText', 'refs', 'image'],
  'computer.focus': ['acted', 'snapshotRevision'],
  'computer.click': ['acted', 'snapshotRevision'],
  'computer.double-click': ['acted', 'snapshotRevision'],
  'computer.drag': ['acted', 'snapshotRevision'],
  'computer.type': ['acted', 'snapshotRevision'],
  'computer.key': ['acted', 'snapshotRevision'],
  'computer.scroll': ['acted', 'snapshotRevision'],
  'computer.wait': ['waited', 'snapshotRevision'],
  'computer.stop': ['stopped'],
  status: ['viewing', 'assistive', 'supported'],
  list: ['apps'],
  snapshot: ['appId', 'windowId', 'snapshotRevision', 'semanticText', 'refs', 'image'],
  focus: ['acted', 'snapshotRevision'],
  click: ['acted', 'snapshotRevision'],
  'double-click': ['acted', 'snapshotRevision'],
  drag: ['acted', 'snapshotRevision'],
  type: ['acted', 'snapshotRevision'],
  key: ['acted', 'snapshotRevision'],
  scroll: ['acted', 'snapshotRevision'],
  wait: ['waited', 'snapshotRevision'],
  stop: ['stopped'],
  'lease.install': ['installed', 'leaseRevision'],
  'input.release': ['released'],
} as const)
