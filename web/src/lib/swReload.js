// Service-worker auto-reload coordinator.
//
// The PWA plugin emits virtual:pwa-register, which exposes the workbox
// registration lifecycle. We hook two events:
//
//   - onNeedRefresh: a NEW service worker is installed and waiting to take
//                    over. Because vite.config sets skipWaiting + clientsClaim
//                    + registerType:'autoUpdate', the SW activates itself
//                    on the next page navigation. To stop showing the user
//                    stale code, we trigger a one-time reload here.
//
//   - onOfflineReady: the first install — the app is now usable offline.
//                     We just log it.
//
// To prevent reload loops, we set a `sw-reloaded` flag on
// sessionStorage so we only auto-reload once per session.
//
// Imported once from main.jsx (top-level side effect on app boot).

const RELOADED_FLAG = 'delta:sw-reloaded';

export function setupServiceWorkerReload() {
  // Only meaningful in the browser, and only when the plugin runs (it's
  // a no-op in dev).
  if (typeof window === 'undefined') return;

  // Lazy import: virtual:pwa-register only exists at build time via the
  // vite-plugin-pwa virtual module. In dev mode (no SW registered), the
  // import resolves to a stub that's still safe to call.
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({
        immediate: true, // Register on first load, don't wait.

        onNeedRefresh() {
          // A new SW is ready. With skipWaiting=true it has already
          // activated, but the page is still running the OLD JS bundle.
          // Force one reload to get the fresh code.
          if (sessionStorage.getItem(RELOADED_FLAG)) {
            // Already reloaded once in this tab — don't loop. The user
            // can refresh manually if needed.
            return;
          }
          sessionStorage.setItem(RELOADED_FLAG, '1');
          // Tiny delay so any in-flight network requests can settle,
          // and to make the transition feel less jarring.
          setTimeout(() => {
            window.location.reload();
          }, 300);
        },

        onOfflineReady() {
          // Optional: could show a toast "Ready to work offline."
          // Keeping silent for now to avoid noise.
        },

        onRegisterError(err) {
          // SW registration failed — usually a transient network error.
          // The app still works; we just lose the offline cache.
          // eslint-disable-next-line no-console
          console.warn('Delta: SW registration failed', err);
        },
      });
    })
    .catch(() => {
      // Dev mode (no PWA virtual module). Silent.
    });
}
