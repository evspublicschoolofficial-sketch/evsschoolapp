import React, { ComponentType } from 'react';

const LAZY_CHUNK_RELOAD_KEY = 'evs_lazy_chunk_reload_ts';

const isChunkLoadFailure = (err: any): boolean => {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('loading chunk') ||
    msg.includes('chunkloaderror') ||
    msg.includes('error loading dynamically imported module')
  );
};

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    try {
      return await factory();
    } catch (firstErr) {
      // Brief transient network retry before treating it as a stale deploy chunk
      await new Promise((resolve) => setTimeout(resolve, 350));
      try {
        return await factory();
      } catch (secondErr) {
        if (typeof window !== 'undefined' && isChunkLoadFailure(secondErr)) {
          try {
            const lastTs = Number(sessionStorage.getItem(LAZY_CHUNK_RELOAD_KEY) || '0');
            if (!lastTs || Date.now() - lastTs > 15000) {
              sessionStorage.setItem(LAZY_CHUNK_RELOAD_KEY, String(Date.now()));
              if ('caches' in window) {
                const keys = await window.caches.keys();
                await Promise.all(keys.map((k) => window.caches.delete(k).catch(() => {})));
              }
              if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map((r) => r.update().catch(() => {})));
              }
              try {
                await fetch('/index.html', { cache: 'reload' });
              } catch {}
              window.location.reload();
              return new Promise<{ default: T }>(() => {});
            }
          } catch {}
        }
        throw secondErr;
      }
    }
  });
}
