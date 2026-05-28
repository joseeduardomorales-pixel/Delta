// Build-time stamps, injected by vite.config.js via `define`.
// Use these to diagnose "is the tech on an old build?" without asking
// them to open dev tools.

/* global __BUILD_SHA__, __BUILD_TIME__ */

export const BUILD_SHA =
  typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev';

export const BUILD_TIME =
  typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : new Date().toISOString();

// Short, human-friendly label e.g. "3046c49 · 5/27".
export function buildLabel() {
  const sha = BUILD_SHA.slice(0, 7);
  const d = new Date(BUILD_TIME);
  const datePart = `${d.getMonth() + 1}/${d.getDate()}`;
  return `${sha} · ${datePart}`;
}
