import { useEffect, useRef } from 'react';
import { useUIStore } from '@/stores/ui-store';

/**
 * Sole owner of Electron BrowserView lifecycle.
 * Store open/url drive create → navigate → close so /browse and any opener work.
 */
export function useMiniBrowserBridge() {
  const miniBrowserOpen = useUIStore((s) => s.miniBrowserOpen);
  const miniBrowserUrl = useUIStore((s) => s.miniBrowserUrl);
  const setMiniBrowserUrl = useUIStore((s) => s.setMiniBrowserUrl);

  const viewAliveRef = useRef(false);
  const skipNavigateRef = useRef(false);
  const lastUrlRef = useRef<string | null>(null);

  // BrowserView → store (in-page links, redirects, history)
  useEffect(() => {
    const api = window.electronAPI?.browser;
    if (!api?.onNavigated) return;

    return api.onNavigated((url) => {
      skipNavigateRef.current = true;
      lastUrlRef.current = url;
      setMiniBrowserUrl(url);
    });
  }, [setMiniBrowserUrl]);

  // Store → BrowserView
  useEffect(() => {
    const api = window.electronAPI?.browser;
    if (!api?.create || !api.close || !api.navigate) return;

    if (miniBrowserOpen) {
      const target = miniBrowserUrl || 'about:blank';

      if (!viewAliveRef.current) {
        viewAliveRef.current = true;
        lastUrlRef.current = target;
        skipNavigateRef.current = false;
        void api.create(target).then((ok) => {
          if (ok === false) {
            viewAliveRef.current = false;
            lastUrlRef.current = null;
          }
        });
        return;
      }

      if (skipNavigateRef.current) {
        skipNavigateRef.current = false;
        return;
      }

      if (target !== lastUrlRef.current && target !== 'about:blank') {
        lastUrlRef.current = target;
        void api.navigate(target);
      }
      return;
    }

    if (viewAliveRef.current) {
      viewAliveRef.current = false;
      lastUrlRef.current = null;
      skipNavigateRef.current = false;
      void api.close();
    }
  }, [miniBrowserOpen, miniBrowserUrl]);
}
