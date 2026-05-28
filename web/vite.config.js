import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

// Read the current git SHA + ISO timestamp at build time. We bake this
// into the bundle as VITE_BUILD_SHA / VITE_BUILD_TIME so the UI can show
// it — invaluable for "is the tech on the old build?" debugging.
function readBuildStamp() {
  try {
    const sha = execSync('git rev-parse --short HEAD').toString().trim();
    return { sha, time: new Date().toISOString() };
  } catch {
    return { sha: 'unknown', time: new Date().toISOString() };
  }
}
const stamp = readBuildStamp();

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(stamp.sha),
    __BUILD_TIME__: JSON.stringify(stamp.time),
  },
  plugins: [
    react(),
    VitePWA({
      // autoUpdate + skipWaiting + clientsClaim means a freshly installed
      // SW takes over IMMEDIATELY rather than waiting for all tabs to close.
      // We pair this with a registration hook in src/main.jsx that listens
      // for `onNeedRefresh` and triggers a one-time `location.reload()` so
      // the user picks up the new bundle without any "open incognito" dance.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Delta',
        short_name: 'Delta',
        description: 'Cold Cargo maintenance log',
        theme_color: '#FAFAFA',
        background_color: '#FAFAFA',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Activate immediately on install + claim all open tabs.
        skipWaiting: true,
        clientsClaim: true,
        // The precache (built from rollup output) covers every hashed
        // asset by content-hash, so we don't need broad runtime caching.
        // We previously had `NetworkFirst` for everything same-origin —
        // that overlapped with the precache AND would happily serve the
        // stale index.html if the network blip lasted half a second.
        // Now: workbox handles navigations via the precache index, and
        // we explicitly exclude any /api/* path (delta-api is a different
        // origin in prod, but we still block here in case anyone serves
        // the API behind the same domain later).
        navigateFallback: '/index.html',
        // Don't intercept /api/* (different origin in prod anyway), and
        // don't intercept ?reset=1 — that URL is the user's escape hatch
        // when the SW itself is broken; we MUST fall through to network
        // so the fresh index.html (with killswitch inline) loads.
        navigateFallbackDenylist: [/^\/api\//, /[?&]reset=1\b/],
        // Smaller cache footprint + an explicit cleanup on activate.
        cleanupOutdatedCaches: true,
        // Pre-cache size: ~600KB JS gz, plus assets. Default 2MB limit is
        // fine but we raise to 4MB to be safe for future growth.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
