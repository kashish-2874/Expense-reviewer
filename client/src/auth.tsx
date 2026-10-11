import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler } from "./api";
import { navigate } from "./router";
import type { User } from "./types";

// Who is logged in, shared with every component. The session itself is an
// httpOnly cookie the browser handles; the client never sees the token. It
// only asks the server (/api/auth/me) whether the cookie is still valid.

type AuthState =
  | { status: "loading" }
  | { status: "anonymous"; notice?: string } // notice: e.g. "Your session has expired"
  | { status: "authenticated"; user: User };

interface AuthContextValue {
  state: AuthState;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  // On page load: is there already a valid session?
  useEffect(() => {
    api.me().then(
      ({ user }) => setState({ status: "authenticated", user }),
      () => setState({ status: "anonymous" }),
    );
  }, []);

  // Any 401 from a protected call means the session ended (expired, or the
  // cookie was removed): forget the user and send them to log in, remembering
  // where they were so they can come straight back.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setState({ status: "anonymous", notice: "Your session has expired. Please log in again." });
      const here = window.location.pathname + window.location.search;
      navigate(`/login?next=${encodeURIComponent(here)}`, { replace: true });
    });
    return () => setUnauthorizedHandler(undefined);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { user } = await api.login(username, password);
    setState({ status: "authenticated", user });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      // Even if the request failed, stop treating this browser as logged in.
      setState({ status: "anonymous", notice: "You have been logged out." });
      navigate("/login");
    }
  }, []);

  const value = useMemo(() => ({ state, login, logout }), [state, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

// For components that only render inside the protected area.
export function useCurrentUser(): User {
  const { state } = useAuth();
  if (state.status !== "authenticated") throw new Error("useCurrentUser used outside the reviewer area");
  return state.user;
}
