'use client';

import { loader } from '@monaco-editor/react';

/**
 * Serve Monaco from our own origin (copied into public/monaco by
 * scripts/copy-monaco.mjs) instead of the default public CDN — the editor
 * works offline and inside networks where external CDNs are blocked.
 * Imported for its side effect; must run before any loader.init().
 */
loader.config({ paths: { vs: '/monaco/vs' } });

/** Kick off the Monaco download/parse in the background (e.g. right after login). */
export function warmMonaco(): void {
  loader.init().catch(() => {
    /* non-fatal: the editor page will retry on mount */
  });
}
