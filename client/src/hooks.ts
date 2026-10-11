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
