import { useEffect } from 'react';

const BASE = 'Fresha Salon';

/**
 * Set the document title for the current page. Keeps the base brand suffix so
 * browser tabs stay identifiable, and restores the default on unmount so a
 * navigate-away doesn't leave a stale title.
 *
 *   useDocumentTitle('Browse Salons')  // "Browse Salons · Fresha Salon"
 *   useDocumentTitle()                 // resets to "Fresha Salon"
 *
 * No dependency (no react-helmet) — this is enough for an internal app where
 * each route renders a single page component.
 */
export default function useDocumentTitle(title) {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · ${BASE}` : BASE;
    return () => { document.title = previous; };
  }, [title]);
}
