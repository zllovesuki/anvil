import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * Manages SPA route-change accessibility: updates document.title from the
 * page's <h1>, moves focus to it, and announces the navigation via an
 * aria-live region.
 *
 * Returns a ref to attach to a visually-hidden announcer element:
 * `<div ref={announcerRef} className="sr-only" aria-live="polite" />`
 */
export const useRouteAnnouncer = () => {
  const { pathname } = useLocation();
  const announcerRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  const announce = useCallback((text: string) => {
    if (announcerRef.current) {
      announcerRef.current.textContent = text;
    }
  }, []);

  useEffect(() => {
    // Skip the initial mount — only announce subsequent navigations.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Wait a tick for the new page component to render its <h1>.
    const id = requestAnimationFrame(() => {
      const h1 = document.querySelector("h1");
      const title = h1?.textContent?.trim() ?? "anvil";

      document.title = title === "anvil" ? "anvil" : `${title} — anvil`;

      if (h1) {
        if (!h1.hasAttribute("tabindex")) {
          h1.setAttribute("tabindex", "-1");
        }
        h1.focus({ preventScroll: true });
      }

      announce(`Navigated to ${title}`);
    });

    return () => cancelAnimationFrame(id);
  }, [pathname, announce]);

  return announcerRef;
};
