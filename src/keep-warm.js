const WARM_INTERVAL_MS = 8 * 60 * 1000;

let warmTimer = null;

function shouldKeepWarm() {
  const { hostname } = window.location;
  return hostname !== 'localhost' && hostname !== '127.0.0.1';
}

function pingHealth() {
  if (document.visibilityState !== 'visible') return;
  void fetch('/api/health', { cache: 'no-store' }).catch(() => {});
}

function scheduleKeepWarm() {
  clearInterval(warmTimer);
  warmTimer = window.setInterval(pingHealth, WARM_INTERVAL_MS);
}

export function bindKeepWarm() {
  if (!shouldKeepWarm()) return;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      pingHealth();
      scheduleKeepWarm();
    }
  });

  scheduleKeepWarm();
}
