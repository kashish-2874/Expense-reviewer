import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

// A very small router over the browser History API: real paths such as
// /claims?page=2 (so refresh, bookmarks and the back button work) without
// adding a routing library for four screens.

const NAVIGATE_EVENT = "app:navigate";

export function navigate(to: string, { replace = false }: { replace?: boolean } = {}) {
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  // pushState does not notify anyone, so tell useLocation ourselves.
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export interface Location {
  pathname: string;
  search: string; // "?page=2&status=approved" or ""
}

const readLocation = (): Location => ({ pathname: window.location.pathname, search: window.location.search });

// Re-renders the component whenever the URL changes (our navigate() or the
// browser's back/forward buttons).
export function useLocation(): Location {
  const [location, setLocation] = useState(readLocation);
  useEffect(() => {
    const update = () => setLocation(readLocation());
    window.addEventListener("popstate", update);
    window.addEventListener(NAVIGATE_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAVIGATE_EVENT, update);
    };
  }, []);
  return location;
}

// An <a> that navigates without a full page reload. Ctrl/Cmd/middle clicks
// are left to the browser so "open in new tab" still works.
export function Link({ to, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={onClick} {...rest} />;
}

// Before the app had real paths it used hash URLs (#/claims/9, #/new, #/).
// Old bookmarks and open tabs still carry them, so translate them once on
// page load instead of silently showing the home page.
export function redirectLegacyHashUrl(): void {
  const hash = window.location.hash;
  if (!hash.startsWith("#/")) return;
  const old = hash.slice(1); // "/claims/9", "/new", "/"
  const target = old === "/new" ? "/submit-claim" : old === "/" ? "/claims" : old;
  window.history.replaceState(null, "", target);
}

// Only allow returning to a page on this site after login: "/claims/9" is
// fine, but "https://evil.example" or "//evil.example" is not (open redirect).
export function safeReturnPath(next: string | null, fallback: string): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : fallback;
}
