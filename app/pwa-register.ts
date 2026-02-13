export function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    // Ensure scope is root
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(() => {});
  });
}

