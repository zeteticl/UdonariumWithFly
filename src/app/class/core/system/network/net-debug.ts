/**
 * Verbose P2P / file-sync console chatter.
 * Enable: localStorage.setItem('UDONARIUM_NET_DEBUG', '1'); location.reload()
 * Disable: localStorage.removeItem('UDONARIUM_NET_DEBUG')
 */
export function isNetDebug(): boolean {
  try {
    return typeof localStorage !== 'undefined'
      && localStorage.getItem('UDONARIUM_NET_DEBUG') === '1';
  } catch {
    return false;
  }
}

export function netDebug(...args: unknown[]) {
  if (!isNetDebug()) return;
  console.log(...args);
}
