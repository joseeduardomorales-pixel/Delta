// Service-worker registration.
//
// Why this is intentionally minimal:
//   The PREVIOUS version of this file auto-reloaded the page on
//   `onNeedRefresh`. That sounded clever — get the user onto the new
//   bundle ASAP — but the SW takes a few seconds to download and install
//   the precache (~660KB). If the user was mid-form (e.g. typing a
//   password and clicking Sign In) when the timeout fired, the reload
//   looked like "I clicked sign in and the page refreshed", and the
//   in-flight auth handshake was killed.
//
// Current strategy:
//   - vite.config sets registerType:'autoUpdate' + skipWaiting + clientsClaim.
//     That gives us: a new SW installs in the background, takes over the
//     tab immediately, but the JS already running in the page keeps running
//     until the user navigates. On the NEXT navigation/refresh they get the
//     fresh hashed JS naturally (index.html is no-store).
//   - Render serves no-store on /index.html, /sw.js, /manifest.webmanifest
//     so nothing stale survives a redeploy at the CDN/browser level.
//   - One-visit lag for users with the PWA installed is acceptable for
//     Cold Cargo's use case. If we ever need a "new version available —
//     tap to refresh" pill, we can wire it through this file.
//
// All this file does now is poke the virtual:pwa-register module so the
// SW gets registered. We log onNeedRefresh/onOfflineReady for visibility,
// but DO NOT reload. Ever.

export function setupServiceWorkerReload() {
  if (typeof window === 'undefined') return;

  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onNeedRefresh() {
          // New SW installed and active (skipWaiting+clientsClaim).
          // The page itself keeps running the old JS until next nav.
          // eslint-disable-next-line no-console
          console.info('Delta: new version installed — refresh anytime to load it.');
        },
        onOfflineReady() {
          // First install — usable offline now.
        },
        onRegisterError(err) {
          // eslint-disable-next-line no-console
          console.warn('Delta: SW registration failed', err);
        },
      });
    })
    .catch(() => {
      // Dev mode or import failure — silent.
    });
}
