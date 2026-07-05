let _handler: (() => void) | null = null;
export function setListRefreshHandler(fn: (() => void) | null) { _handler = fn; }
export function triggerListRefresh() { _handler?.(); }
