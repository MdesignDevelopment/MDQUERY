'use client';

import { useEffect } from 'react';
import { warmMonaco } from '@/lib/monacoSetup';

/**
 * Warms the Monaco editor engine shortly after the app shell mounts, so the
 * first query a user opens gets an instant editor instead of a cold download.
 * Renders nothing.
 */
export default function MonacoWarmup() {
  useEffect(() => {
    const t = setTimeout(warmMonaco, 800); // let the first page's data fetches go first
    return () => clearTimeout(t);
  }, []);
  return null;
}
