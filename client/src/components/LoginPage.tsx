import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { navigate, safeReturnPath, useLocation } from "../router";
import { Card } from "./ui";

// Reviewer login. No sign-up or password reset by design: there is a single
// admin account, created by the server from its environment variables.

export function LoginPage() {
  const { state, login } = useAuth();
  const { search } = useLocation();
  const next = safeReturnPath(new URLSearchParams(search).get("next"), "/claims");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  // Already logged in (or just logged in): go to the page they wanted.
  useEffect(() => {
    if (state.status === "authenticated") navigate(next, { replace: true });
  }, [state.status, next]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return setError("Enter your username and password.");
    setSubmitting(true);
    setError(undefined);
    try {
      await login(username.trim(), password);
      // The effect above redirects once the auth state says "authenticated".
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setPassword("");
      setSubmitting(false);
    }
  }

  const notice = state.status === "anonymous" ? state.notice : undefined;

  return (
    <div className="login-page">
      <Card title="Reviewer login">
        {notice && !error && <div className="alert alert-info">{notice}</div>}
        <form className="form" onSubmit={submit} noValidate>
          <div className="field">
            <label>
              <span className="field-label">Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
            </label>
          </div>
          <div className="field">
            <label>
              <span className="field-label">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
          </div>
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>
      </Card>
    </div>
  );
}
