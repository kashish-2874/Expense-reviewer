import { useCallback, useEffect, useState } from "react";

// Loads data and tracks loading/error state. `reload` refetches; stale
// responses from an earlier call are ignored so fast filter changes are safe.
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    load().then(
      (data) => current && setState({ data, loading: false }),
      (error: Error) => current && setState({ error, loading: false }),
    );
    return () => {
      current = false;
    };
    // `load` is a new closure every render; `deps` says when it really changes.
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}

// Minimal hash router: "#/", "#/new", "#/claims/12". Enough for three screens
// without adding a routing library.
export type Route = { name: "list" } | { name: "new" } | { name: "claim"; id: number };

function parseHash(hash: string): Route {
  const claim = /^#\/claims\/(\d+)$/.exec(hash);
  if (claim) return { name: "claim", id: Number(claim[1]) };
  if (hash === "#/new") return { name: "new" };
  return { name: "list" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export const navigate = (hash: string) => {
  window.location.hash = hash;
};

// The reviewer's name, remembered in this browser for convenience only.
const REVIEWER_KEY = "expense-review.reviewer";

export function useReviewerName(): [string, (name: string) => void] {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(REVIEWER_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const update = (value: string) => {
    setName(value);
    try {
      localStorage.setItem(REVIEWER_KEY, value);
    } catch {
      // Storage can be unavailable (private mode); the name still works for this session.
    }
  };
  return [name, update];
}
